"""Сервис анализа фото MaintAR.

POST /analyze  (multipart: photo, unit_id) -> JSON в формате, который понимает приложение
               (см. cleanVision в src/engine.js):
               {"equipment": str,
                "findings": [{"cls", "confidence", "box": [x, y, w, h] доли кадра, "explanation"}],
                "nodes": [{"comp", "box"}]}
GET  /health   -> состояние сервиса и выбранный провайдер модели.

Провайдер модели задаётся в server/.env (см. .env.example):
  ollama    — локальная модель через Ollama, без ключа и без интернета;
  openai    — любой OpenAI-совместимый API (OpenRouter, OpenAI и т. п.);
  anthropic — Claude через Anthropic API.
Классы дефектов берутся из src/data/rules.json, узлы — из src/data/units.js.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
log = logging.getLogger("maintar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# ---------- настройки ----------
def load_env(path: Path) -> None:
    """Простейший разбор .env: KEY=VALUE, комментарии через #. Переменные окружения важнее файла."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(ROOT / ".env")
CFG = {
    "provider": os.getenv("PROVIDER", "auto").lower(),
    "ollama_url": os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
    "ollama_model": os.getenv("OLLAMA_MODEL", "qwen2.5vl:7b"),
    "openai_url": os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"),
    "openai_model": os.getenv("OPENAI_MODEL", ""),
    "anthropic_model": os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5"),
    "timeout": float(os.getenv("TIMEOUT", "120")),
    "max_side": int(os.getenv("MAX_SIDE", "1280")),
    "min_conf": float(os.getenv("MIN_CONFIDENCE", "0.4")),
}


def pick_provider() -> str:
    if CFG["provider"] in ("ollama", "openai", "anthropic"):
        return CFG["provider"]
    # auto: рабочий ключ из окружения важнее, иначе локальная модель
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.getenv("OPENAI_API_KEY") and CFG["openai_model"]:
        return "openai"
    return "ollama"


PROVIDER = pick_provider()


# ---------- справочники из проекта ----------
RULES = json.loads((PROJECT / "src/data/rules.json").read_text(encoding="utf-8"))
VISUAL = [{"cls": r["class"], "name": r["name"], "signs": r.get("signs", ""), "status": r["status"]} for r in RULES["visual_rules"]]
CLASS_SET = {v["cls"] for v in VISUAL}


def load_units() -> dict[str, list[dict]]:
    """Узлы каждого агрегата из src/data/units.js (id и название), без запуска JS."""
    text = (PROJECT / "src/data/units.js").read_text(encoding="utf-8")
    units: dict[str, list[dict]] = {}
    for block in re.split(r"\n  \{\n", text)[1:]:
        m = re.search(r"id: '([^']+)'", block)
        if not m:
            continue
        comps = re.findall(r"\{ id: '([^']+)', name: '([^']+)'", block)
        units[m.group(1)] = [{"comp": c, "name": n} for c, n in comps]
    return units


UNITS = load_units()


# ---------- промпт ----------
def build_prompt(unit_id: str, width: int, height: int) -> str:
    classes = "\n".join(f'- "{v["cls"]}": {v["name"]}. Признаки: {v["signs"]}' for v in VISUAL)
    comps = UNITS.get(unit_id) or next(iter(UNITS.values()), [])
    nodes = "\n".join(f'- "{c["comp"]}": {c["name"]}' for c in comps)
    return f"""Ты инженер-диагност промышленного насосного оборудования. Осмотри фото и найди видимые дефекты.

Размер изображения: {width}×{height} пикселей.

Разрешённые классы дефектов (поле cls, только из этого списка):
{classes}

Узлы агрегата (поле comp, только из этого списка):
{nodes}

Правила:
1. Отмечай дефект, только если его признаки ясно видны на фото. Не придумывай. Нет видимых дефектов — верни пустой список findings.
2. Если на фото не оборудование, верни пустые findings и nodes, а в equipment напиши, что на фото.
3. box — рамка вокруг дефекта или узла в пикселях этого изображения: [x1, y1, x2, y2] (левый верхний и правый нижний углы).
4. confidence — уверенность от 0 до 1. Если сомневаешься, ставь меньше 0.5.
5. explanation — одно короткое предложение по-русски: что именно видно на фото.
6. nodes — узлы, которые видны на фото (до 4), с рамками.

Ответь только JSON без пояснений:
{{"equipment": "что на фото, по-русски, коротко",
 "findings": [{{"cls": "класс", "confidence": 0.8, "box": [x1, y1, x2, y2], "explanation": "..."}}],
 "nodes": [{{"comp": "узел", "box": [x1, y1, x2, y2]}}]}}"""


JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "equipment": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "cls": {"type": "string", "enum": sorted(CLASS_SET)},
                    "confidence": {"type": "number"},
                    "box": {"type": "array", "items": {"type": "number"}},
                    "explanation": {"type": "string"},
                },
                "required": ["cls", "confidence", "box", "explanation"],
                "additionalProperties": False,
            },
        },
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"comp": {"type": "string"}, "box": {"type": "array", "items": {"type": "number"}}},
                "required": ["comp", "box"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["equipment", "findings", "nodes"],
    "additionalProperties": False,
}


# ---------- изображение ----------
def prepare_image(data: bytes) -> tuple[str, int, int]:
    """Поворот по EXIF, уменьшение до MAX_SIDE, JPEG в base64."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as e:  # повреждённый или не картинка
        raise HTTPException(status_code=400, detail=f"Не удалось прочитать изображение: {e}")
    img.thumbnail((CFG["max_side"], CFG["max_side"]))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii"), img.width, img.height


# ---------- нормализация ответа модели ----------
def parse_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("в ответе нет JSON")
    return json.loads(m.group(0))


def norm_box(box, width: int, height: int):
    """Рамка от модели -> [x, y, w, h] в долях кадра. Понимает пиксели, 0..1 и 0..1000; xyxy и xywh."""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    try:
        a, b, c, d = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    mx = max(a, b, c, d)
    if mx <= 1.0:
        sx, sy = 1.0, 1.0
    elif max(a, c) <= width * 1.05 and max(b, d) <= height * 1.05:
        sx, sy = float(width), float(height)
    elif mx <= 1000:
        sx, sy = 1000.0, 1000.0
    else:
        return None
    a, c = a / sx, c / sx
    b, d = b / sy, d / sy
    if c > a and d > b:      # x1, y1, x2, y2
        x, y, w, h = a, b, c - a, d - b
    else:                    # x, y, w, h
        x, y, w, h = a, b, c, d
    x, y = max(0.0, min(1.0, x)), max(0.0, min(1.0, y))
    w, h = max(0.0, min(1.0 - x, w)), max(0.0, min(1.0 - y, h))
    if w < 0.01 or h < 0.01:
        return None
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]


def clean(raw: dict, unit_id: str, width: int, height: int) -> dict:
    comps = {c["comp"] for c in UNITS.get(unit_id, [])}
    findings, seen = [], set()
    for f in raw.get("findings") or []:
        if not isinstance(f, dict) or f.get("cls") not in CLASS_SET:
            continue
        try:
            conf = max(0.0, min(1.0, float(f.get("confidence", 0.5))))
        except (TypeError, ValueError):
            conf = 0.5
        if conf < CFG["min_conf"]:
            continue
        box = norm_box(f.get("box"), width, height)
        key = (f["cls"], tuple(box) if box else None)
        if key in seen:
            continue
        seen.add(key)
        item = {"cls": f["cls"], "confidence": round(conf, 2), "explanation": str(f.get("explanation", ""))[:300]}
        if box:
            item["box"] = box
        findings.append(item)
    nodes = []
    for n in raw.get("nodes") or []:
        if isinstance(n, dict) and (not comps or n.get("comp") in comps):
            box = norm_box(n.get("box"), width, height)
            if box:
                nodes.append({"comp": n["comp"], "box": box})
    return {"equipment": str(raw.get("equipment", ""))[:120], "findings": findings[:12], "nodes": nodes[:6]}


# ---------- провайдеры ----------
def ask_ollama(prompt: str, b64: str) -> str:
    r = httpx.post(
        f"{CFG['ollama_url']}/api/chat",
        json={
            "model": CFG["ollama_model"],
            "messages": [{"role": "user", "content": prompt, "images": [b64]}],
            "format": "json",
            "stream": False,
            "options": {"temperature": 0},
            "keep_alive": "30m",
        },
        timeout=CFG["timeout"],
    )
    r.raise_for_status()
    return r.json()["message"]["content"]


def ask_openai(prompt: str, b64: str) -> str:
    key = os.getenv("OPENAI_API_KEY", "")
    r = httpx.post(
        f"{CFG['openai_url']}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": CFG["openai_model"],
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                {"type": "text", "text": prompt},
            ]}],
        },
        timeout=CFG["timeout"],
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


_anthropic_client = None


def ask_anthropic(prompt: str, b64: str) -> str:
    global _anthropic_client
    import anthropic

    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic(timeout=CFG["timeout"])
    resp = _anthropic_client.beta.messages.create(
        model=CFG["anthropic_model"],
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": JSON_SCHEMA}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
            {"type": "text", "text": prompt},
        ]}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("модель отказалась анализировать фото")
    return "".join(b.text for b in resp.content if b.type == "text")


ASK = {"ollama": ask_ollama, "openai": ask_openai, "anthropic": ask_anthropic}


def model_name() -> str:
    return {"ollama": CFG["ollama_model"], "openai": CFG["openai_model"], "anthropic": CFG["anthropic_model"]}[PROVIDER]


# ---------- приложение ----------
app = FastAPI(title="MaintAR — анализ фото")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    ready, note = True, ""
    if PROVIDER == "ollama":
        try:
            tags = httpx.get(f"{CFG['ollama_url']}/api/tags", timeout=3).json()
            names = [m.get("name", "") for m in tags.get("models", [])]
            if CFG["ollama_model"] not in names and f"{CFG['ollama_model']}:latest" not in names:
                ready, note = False, f"модель {CFG['ollama_model']} не скачана: ollama pull {CFG['ollama_model']}"
        except Exception:
            ready, note = False, "Ollama не запущен"
    elif PROVIDER == "openai" and not os.getenv("OPENAI_API_KEY"):
        ready, note = False, "нет OPENAI_API_KEY"
    return {"ok": ready, "provider": PROVIDER, "model": model_name(), "classes": len(CLASS_SET), "note": note}


@app.post("/analyze")
async def analyze(photo: UploadFile = File(...), unit_id: str = Form("CN-1")):
    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")
    b64, w, h = prepare_image(data)
    prompt = build_prompt(unit_id, w, h)
    t0 = time.time()
    last_err = None
    for attempt in range(2):  # повтор, если модель вернула невалидный JSON
        try:
            text = ASK[PROVIDER](prompt if attempt == 0 else prompt + "\n\nПрошлый ответ был не JSON. Верни только JSON.", b64)
            result = clean(parse_json(text), unit_id, w, h)
            result["model"] = model_name()
            result["elapsed"] = round(time.time() - t0, 1)
            log.info("analyze %s: %d дефектов за %.1f c", unit_id, len(result["findings"]), result["elapsed"])
            return result
        except (ValueError, json.JSONDecodeError) as e:
            last_err = e
            log.warning("невалидный ответ модели (попытка %d): %s", attempt + 1, e)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Модель не ответила вовремя")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Модель недоступна: {e}")
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:  # ошибки SDK провайдера (ключ, лимиты, сеть)
            log.exception("ошибка провайдера")
            raise HTTPException(status_code=502, detail=f"Ошибка модели: {type(e).__name__}: {e}")
    raise HTTPException(status_code=502, detail=f"Модель вернула некорректный ответ: {last_err}")
