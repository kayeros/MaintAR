"""
Обученный детектор дефектов (YOLO), дополняет мультимодальную модель.

Веса ищутся в VISION_DETECTOR или models/pump_defects.pt. Нужен пакет
ultralytics (pip install ultralytics). Если весов или пакета нет, детектор
молча выключен и сервис работает как раньше.
"""
from __future__ import annotations

import io
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
_MODEL = None
_TRIED = False
DET_CONF = float(os.getenv("VISION_DETECTOR_CONF", "0.35"))
_CFG = None


def config() -> dict:
    """Настройки инференса: models/detector_config.json (пишет train/tune.py) и переменные окружения."""
    global _CFG
    if _CFG is None:
        _CFG = {"conf": DET_CONF, "imgsz": 640, "augment": False, "class_conf": {}}
        w = weights_path()
        cfg_file = (w.parent if w else HERE / "models") / "detector_config.json"
        if cfg_file.is_file():
            import json
            try:
                _CFG.update(json.loads(cfg_file.read_text(encoding="utf-8")))
            except Exception as e:
                print(f"[detector] {cfg_file.name} не прочитан: {e}")
        if os.getenv("VISION_DETECTOR_CONF"):
            _CFG["conf"] = DET_CONF
            _CFG["class_conf"] = {}
    return _CFG


def weights_path() -> Path | None:
    p = Path(os.getenv("VISION_DETECTOR", HERE / "models" / "pump_defects.pt"))
    return p if p.is_file() else None


def load():
    global _MODEL, _TRIED
    if _TRIED:
        return _MODEL
    _TRIED = True
    w = weights_path()
    if not w:
        return None
    try:
        from ultralytics import YOLO
        _MODEL = YOLO(str(w))
        print(f"[detector] загружен {w.name}, классы: {list(_MODEL.names.values())}")
    except Exception as e:
        print(f"[detector] не загружен: {e}")
        _MODEL = None
    return _MODEL


def available() -> bool:
    return load() is not None


def classes() -> list[str]:
    m = load()
    return list(m.names.values()) if m else []


def detect(jpeg: bytes, conf: float | None = None) -> list[dict]:
    """Находки в формате ответа модели: cls, confidence, box [x,y,w,h] в долях."""
    m = load()
    if m is None:
        return []
    from PIL import Image
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    W, H = im.size
    cfg = config()
    base = cfg["conf"] if conf is None else conf
    class_conf = {} if conf is not None else cfg.get("class_conf", {})
    floor = min([base, *class_conf.values()])
    res = m.predict(im, conf=floor, verbose=False, imgsz=int(cfg["imgsz"]), augment=bool(cfg["augment"]))[0]
    out = []
    for b in res.boxes:
        x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
        cls = m.names[int(b.cls)]
        if float(b.conf) < class_conf.get(cls, base):
            continue
        out.append({
            "cls": cls,
            "confidence": round(float(b.conf), 2),
            "box": [x1 / W, y1 / H, (x2 - x1) / W, (y2 - y1) / H],
            "explanation": "Найдено детектором YOLO, обученным на открытых наборах данных.",
            "by": "detector",
        })
    return out
