"""
Ядро анализа фото для POST /analyze.

Цепочка: фото -> уменьшение до 1280 px -> мультимодальная модель с prompt.txt
-> разбор JSON -> проверка (класс из списка, рамка в кадре, confidence >= 0.4)
-> обогащение (название, статус, узел, рекомендация) -> кэш.

Если модель недоступна: демо-кэш (по перцептивному хэшу, переживает пересжатие
фото телефоном) -> офлайн-детектор коррозии на классическом CV -> пустой ответ
с полем error.

Зависимости: только стандартная библиотека, Pillow и numpy.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
MIN_CONFIDENCE = float(os.getenv("VISION_MIN_CONFIDENCE", "0.4"))
MAX_SIDE = int(os.getenv("VISION_MAX_SIDE", "1280"))
TIMEOUT = float(os.getenv("VISION_TIMEOUT", "60"))
CACHE_DIR = Path(os.getenv("VISION_CACHE_DIR", HERE / "cache"))
DEMO_CACHE = Path(os.getenv("VISION_DEMO_CACHE", HERE / "demo_cache" / "demo.json"))
DISCLAIMER = "Предварительный осмотр. Отсутствие видимых дефектов не подтверждает исправность"
SEVERITY = {"ok": 0, "check": 1, "defect": 2}


# ---------------------------------------------------------------- справочник

def _find_rules() -> Path | None:
    cands = [os.getenv("RULES_PATH"), HERE / "rules.json",
             HERE.parent / "pump-diagnostics" / "rules.json"]
    for c in cands:
        if c and Path(c).is_file():
            return Path(c)
    return None


def load_catalog() -> dict:
    """Классы из rules.json (если есть), иначе из classes.json."""
    base = json.loads((HERE / "classes.json").read_text(encoding="utf-8"))
    classes: dict = dict(base["classes"])
    rules_path = _find_rules()
    source = "classes.json"
    if rules_path:
        try:
            rules = json.loads(rules_path.read_text(encoding="utf-8"))
            vr = rules.get("visual_rules") or []
            if isinstance(vr, dict):
                vr = [dict(v, **{"class": k}) if "class" not in v else v for k, v in vr.items()]
            merged = {}
            for r in vr:
                cls = r.get("class")
                if not cls:
                    continue
                meta = dict(classes.get(cls, {}))
                for src, dst in (("name", "name"), ("diagnosis", "name"), ("status", "status"),
                                 ("recommendation", "recommendation"), ("comp", "comp")):
                    if r.get(src):
                        meta[dst] = r[src]
                meta.setdefault("name", cls)
                meta.setdefault("status", "check")
                merged[cls] = meta
            if merged:
                classes, source = merged, str(rules_path)
        except Exception as e:  # битый rules.json не должен ронять сервис
            print(f"[vision] rules.json не прочитан ({e}), беру classes.json")
    return {"classes": classes, "components": base["components"],
            "statuses": base["statuses"], "source": source}


CATALOG = load_catalog()
PROMPT = (HERE / "prompt.txt").read_text(encoding="utf-8")


# ---------------------------------------------------------------- изображение

def prepare_image(data: bytes, max_side: int = MAX_SIDE) -> tuple[bytes, int, int]:
    """Поворот по EXIF, RGB, уменьшение до max_side. Возвращает JPEG и размеры."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue(), im.width, im.height


def dhash(data: bytes, size: int = 8) -> int:
    """Перцептивный хэш: совпадает у того же фото после пересжатия и уменьшения."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("L")
    im = im.resize((size + 1, size), Image.LANCZOS)
    px = list(im.tobytes())
    bits = 0
    for r in range(size):
        for c in range(size):
            bits = (bits << 1) | (px[r * (size + 1) + c] > px[r * (size + 1) + c + 1])
    return bits


# ---------------------------------------------------------------- провайдеры

def provider_config(override: str | None = None) -> dict:
    """VISION_PROVIDER: anthropic | openai | yolo | offline | auto (по умолчанию)."""
    prov = (override or os.getenv("VISION_PROVIDER", "auto")).lower()
    if prov == "auto":
        if os.getenv("ANTHROPIC_API_KEY"):
            prov = "anthropic"
        elif os.getenv("VISION_BASE_URL") or os.getenv("OPENAI_API_KEY"):
            prov = "openai"
        else:
            prov = "offline"
    if prov == "anthropic":
        return {"provider": prov, "model": os.getenv("VISION_MODEL", "claude-sonnet-5-5"),
                "key": os.getenv("ANTHROPIC_API_KEY") or os.getenv("VISION_API_KEY", ""),
                "base_url": os.getenv("VISION_BASE_URL", "https://api.anthropic.com")}
    if prov == "openai":
        # Подходит для OpenAI, OpenRouter, локальных Ollama / LM Studio / vLLM
        return {"provider": prov, "model": os.getenv("VISION_MODEL", "gpt-4o"),
                "key": os.getenv("VISION_API_KEY") or os.getenv("OPENAI_API_KEY", "none"),
                "base_url": os.getenv("VISION_BASE_URL", "https://api.openai.com/v1")}
    if prov == "yolo":
        return {"provider": "yolo", "model": "yolo_detector", "key": "", "base_url": ""}
    return {"provider": "offline", "model": "cv_rust", "key": "", "base_url": ""}


def _post_json(url: str, payload: dict, headers: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"HTTP {e.code} от модели: {body}") from e


def call_model(jpeg: bytes, cfg: dict, extra_user: str = "") -> str:
    """Отправляет фото в модель, возвращает сырой текст ответа."""
    b64 = base64.b64encode(jpeg).decode()
    user_text = "Проанализируй фото по инструкции. Ответ строго JSON." + extra_user
    if cfg["provider"] == "anthropic":
        payload = {
            "model": cfg["model"], "max_tokens": 1500, "temperature": 0,
            "system": PROMPT,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                {"type": "text", "text": user_text}]}],
        }
        resp = _post_json(cfg["base_url"].rstrip("/") + "/v1/messages", payload,
                          {"x-api-key": cfg["key"], "anthropic-version": "2023-06-01"})
        return "".join(b.get("text", "") for b in resp.get("content", []))
    if cfg["provider"] == "openai":
        payload = {
            "model": cfg["model"], "temperature": 0, "max_tokens": 1500,
            "messages": [
                {"role": "system", "content": PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": user_text}]}],
        }
        resp = _post_json(cfg["base_url"].rstrip("/") + "/chat/completions", payload,
                          {"Authorization": f"Bearer {cfg['key']}"})
        return resp["choices"][0]["message"]["content"] or ""
    raise RuntimeError(f"Неизвестный провайдер {cfg['provider']}")


# ---------------------------------------------------------------- разбор и проверка

def extract_json(text: str) -> dict | None:
    """Достаёт первый JSON-объект из ответа (ограды ```json, текст вокруг)."""
    if not text:
        return None
    text = re.sub(r"```(?:json)?", "", text)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                esc = (ch == "\\") and not esc
                if ch == '"' and not esc:
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    return None


def _norm_cls(raw) -> str:
    return re.sub(r"[\s\-]+", "_", str(raw or "").strip().lower())


def normalize_box(raw, img_w: int | None = None, img_h: int | None = None) -> list[float] | None:
    """
    Приводит рамку к [x, y, w, h] в долях кадра. Понимает доли, пиксели и
    промилле (0..1000, так отвечают Qwen и Gemini). Возвращает None, если рамка
    битая или больше чем наполовину вне кадра.
    """
    if isinstance(raw, dict):
        raw = [raw.get(k) for k in ("x", "y", "w", "h")]
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    m = max(x, y, w, h)
    # Доли (все числа <= 1) принимаются всегда. Числа больше 1 трактуются по
    # VISION_BOX_UNITS: auto (до 1000 промилле, иначе пиксели) | pixel | permille.
    units = os.getenv("VISION_BOX_UNITS", "auto") if m > 1.0 else "fraction"
    if units == "auto":
        units = "permille" if m <= 1000 else "pixel"
    if units == "permille":
        x, y, w, h = x / 1000, y / 1000, w / 1000, h / 1000
    elif units == "pixel":
        if not (img_w and img_h):
            return None
        x, w, y, h = x / img_w, w / img_w, y / img_h, h / img_h
    # модель могла вернуть [x1,y1,x2,y2] вместо [x,y,w,h]
    if (x + w > 1.02 or y + h > 1.02) and w > x and h > y and w <= 1.0 and h <= 1.0:
        w, h = w - x, h - y
    if w <= 0 or h <= 0:
        return None
    area = w * h
    cx0, cy0 = max(0.0, x), max(0.0, y)
    cx1, cy1 = min(1.0, x + w), min(1.0, y + h)
    if cx1 <= cx0 or cy1 <= cy0:
        return None
    inside = (cx1 - cx0) * (cy1 - cy0)
    if inside / area < 0.5 or (cx1 - cx0) < 0.01 or (cy1 - cy0) < 0.01:
        return None
    return [round(cx0, 4), round(cy0, 4), round(cx1 - cx0, 4), round(cy1 - cy0, 4)]


def iou(a, b) -> float:
    ax1, ay1, bx1, by1 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax1, bx1) - max(a[0], b[0]))
    ih = max(0.0, min(ay1, by1) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def validate(obj: dict, img_w: int | None = None, img_h: int | None = None,
             catalog: dict = CATALOG) -> tuple[dict, list[str]]:
    """Чистит ответ модели по контракту. Возвращает ответ и список отброшенного."""
    classes, comps = catalog["classes"], catalog["components"]
    dropped: list[str] = []
    findings = []
    for f in obj.get("findings") or []:
        if not isinstance(f, dict):
            continue
        cls = _norm_cls(f.get("cls") or f.get("class"))
        if cls not in classes:
            dropped.append(f"класс вне списка: {cls}")
            continue
        try:
            conf = float(f.get("confidence", 0))
        except (TypeError, ValueError):
            conf = 0.0
        conf = conf / 100 if 1 < conf <= 100 else conf
        if conf < MIN_CONFIDENCE:
            dropped.append(f"{cls}: confidence {conf:.2f} < {MIN_CONFIDENCE}")
            continue
        box = normalize_box(f.get("box"), img_w, img_h)
        if box is None:
            dropped.append(f"{cls}: рамка вне кадра или битая {f.get('box')}")
            continue
        meta = classes[cls]
        findings.append({
            "cls": cls,
            "confidence": round(min(conf, 1.0), 2),
            "box": box,
            "explanation": str(f.get("explanation") or "")[:240],
            "name": meta.get("name", cls),
            "status": meta.get("status", "check"),
            "comp": meta.get("comp"),
            "recommendation": meta.get("recommendation", ""),
            "by": f.get("by", "model"),
        })
    # дубликаты одного класса с сильным перекрытием
    findings.sort(key=lambda f: -f["confidence"])
    kept = []
    for f in findings:
        if any(k["cls"] == f["cls"] and iou(k["box"], f["box"]) > 0.6 for k in kept):
            dropped.append(f"{f['cls']}: дубликат")
            continue
        kept.append(f)

    nodes = []
    for n in obj.get("nodes") or []:
        if not isinstance(n, dict):
            continue
        comp = _norm_cls(n.get("comp"))
        box = normalize_box(n.get("box"), img_w, img_h)
        if comp not in comps or box is None:
            dropped.append(f"узел отброшен: {comp}")
            continue
        nodes.append({"comp": comp, "name": comps[comp], "box": box})

    status = max((f["status"] for f in kept), key=lambda s: SEVERITY.get(s, 1), default="ok")
    return {
        "equipment": str(obj.get("equipment") or "")[:80],
        "findings": kept,
        "nodes": nodes,
        "status": status,
        "status_text": catalog["statuses"].get(status, status),
        "disclaimer": DISCLAIMER,
    }, dropped


def empty_response(error: str | None = None, equipment: str = "") -> dict:
    r = {"equipment": equipment, "findings": [], "nodes": [], "status": "ok",
         "status_text": CATALOG["statuses"]["ok"], "disclaimer": DISCLAIMER}
    if error:
        r["error"] = error
    return r


# ---------------------------------------------------------------- кэши

def _cache_key(data: bytes, cfg: dict) -> str:
    h = hashlib.sha256(data)
    h.update(f"|{cfg['provider']}|{cfg['model']}|".encode())
    h.update(hashlib.sha256(PROMPT.encode()).digest())
    return h.hexdigest()


def cache_get(key: str) -> dict | None:
    p = CACHE_DIR / f"{key}.json"
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def cache_put(key: str, resp: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / f"{key}.json").write_text(json.dumps(resp, ensure_ascii=False, indent=1),
                                               encoding="utf-8")
    except OSError:
        pass


_DEMO: list | None = None


def demo_lookup(data: bytes, max_dist: int = 10) -> dict | None:
    """Ищет готовый ответ для показательного фото по dHash (расстояние Хэмминга)."""
    global _DEMO
    if _DEMO is None:
        try:
            _DEMO = json.loads(DEMO_CACHE.read_text(encoding="utf-8"))["items"]
        except Exception:
            _DEMO = []
    if not _DEMO:
        return None
    try:
        h = dhash(data)
    except Exception:
        return None
    best = min(_DEMO, key=lambda it: bin(h ^ int(it["dhash"], 16)).count("1"))
    if bin(h ^ int(best["dhash"], 16)).count("1") <= max_dist:
        return json.loads(json.dumps(best["response"]))
    return None


# ---------------------------------------------------------------- главный вход

def _detector():
    """Модуль обученного детектора, если веса и ultralytics есть, иначе None."""
    if os.getenv("VISION_HYBRID", "1") == "0":
        return None
    try:
        import detector
        return detector if detector.available() else None
    except Exception:
        return None


def merge_detector(resp: dict, jpeg: bytes, det) -> dict:
    """Добавляет находки детектора к ответу; одинаковые классы с перекрытием сливаются."""
    raw = det.detect(jpeg)
    if not raw:
        return resp
    extra, _ = validate({"findings": raw, "nodes": []})
    merged = list(resp.get("findings", []))
    for f in extra["findings"]:
        twin = next((m for m in merged if m["cls"] == f["cls"] and iou(m["box"], f["box"]) > 0.3), None)
        if twin:
            twin["by"] = "model+detector"
            twin["confidence"] = max(twin["confidence"], f["confidence"])
        else:
            merged.append(f)
    resp["findings"] = merged
    status = max((f["status"] for f in merged), key=lambda s: SEVERITY.get(s, 1), default="ok")
    resp["status"], resp["status_text"] = status, CATALOG["statuses"].get(status, status)
    resp["detector"] = True
    return resp


def analyze_image(data: bytes, unit_id: str | None = None, *, use_cache: bool = True,
                  use_demo_cache: bool = True, provider: str | None = None) -> dict:
    """
    Анализ одного фото. Возвращает ответ в формате контракта /analyze плюс
    служебные поля: status, status_text, disclaimer, source, model, ms, dropped.
    Если обучен детектор (models/pump_defects.pt), его находки добавляются
    к ответу мультимодальной модели (поле by у находки: model, detector или оба).
    """
    t0 = time.time()
    cfg = provider_config(provider)
    demo_first = os.getenv("VISION_DEMO_MODE", "0") == "1"
    det = _detector()

    def finish(resp: dict, source: str) -> dict:
        if det is not None and source in ("model", "cache", "cv_offline", "detector"):
            resp = merge_detector(resp, jpeg, det)
        resp["source"] = source
        resp["model"] = cfg["model"] if source in ("model", "cache") else source
        resp["ms"] = int((time.time() - t0) * 1000)
        if unit_id:
            resp["unit_id"] = unit_id
        return resp

    try:
        jpeg, w, h = prepare_image(data)
    except Exception as e:
        jpeg = b""
        det = None
        return finish(empty_response(f"Не удалось открыть изображение: {e}"), "error")

    if demo_first and use_demo_cache:
        d = demo_lookup(data)
        if d:
            return finish(d, "demo_cache")

    if cfg["provider"] == "yolo":  # только обученный детектор
        if det is None:
            return finish(empty_response("Детектор не загружен: нет весов или ultralytics"), "error")
        return finish(empty_response(), "detector")

    if cfg["provider"] == "offline":  # модели нет: эталон для демо-фото, иначе детектор или CV
        d = demo_lookup(data) if use_demo_cache else None
        if d:
            return finish(d, "demo_cache")
        return finish(empty_response(), "detector") if det else finish(offline_response(jpeg), "cv_offline")

    key = _cache_key(data, cfg)
    if use_cache:
        cached = cache_get(key)
        if cached:
            return finish(cached, "cache")

    error = None
    for attempt in range(2):
        try:
            extra = "" if attempt == 0 else (
                "\nПредыдущий ответ не разобрался как JSON. Верни ТОЛЬКО один JSON-объект, без текста и ```.")
            raw = call_model(jpeg, cfg, extra)
            obj = extract_json(raw)
            if obj is None:
                error = f"Модель вернула не JSON: {raw[:120]!r}"
                continue
            resp, dropped = validate(obj, w, h)
            if dropped:
                resp["dropped"] = dropped
            if use_cache:
                cache_put(key, json.loads(json.dumps(resp)))
            return finish(resp, "model")
        except Exception as e:
            error = f"Ошибка модели: {e}"
            if "HTTP 4" in str(e) and "429" not in str(e):
                break  # ключ/запрос неверный, повтор не поможет

    # модель отказала: запасные пути
    if use_demo_cache:
        d = demo_lookup(data)
        if d:
            d["warning"] = error
            return finish(d, "demo_cache")
    if det is not None:
        resp = empty_response(error)
        return finish(resp, "detector")
    resp = offline_response(jpeg)
    resp["error"] = error
    return finish(resp, "cv_offline")


def offline_response(jpeg: bytes) -> dict:
    """Ответ без нейросети: только детектор ржавчины на классическом CV."""
    from cv_rust import detect_rust
    raw = {"equipment": "не определено (офлайн-режим)",
           "findings": detect_rust(jpeg), "nodes": []}
    resp, _ = validate(raw)
    return resp


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        print(p)
        print(json.dumps(analyze_image(Path(p).read_bytes()), ensure_ascii=False, indent=1))
