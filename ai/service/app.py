"""Сервис ИИ MaintAR на обученных моделях YOLOv8 (контракт MaintARBackend, Services/Ai/AiAnalysisClient.cs).

POST /analyze  multipart: photo (файл), context (JSON: equipmentId, equipmentType, model,
               components[{id, name}], defectTypes[{code, name}])
-> {"findings": [{"componentId", "defectCode", "category", "confidence", "explanation",
                  "recommendation", "box": {"x", "y", "width", "height"}}]}
   box — доли кадра (левый верхний угол + размер), category — NoVisibleProblems | CheckRecommended | PossibleDefect.
GET  /health   -> какие веса загружены и на каком устройстве.

Модели (пути переопределяются переменными BASIC_WEIGHTS и EXPANDED_WEIGHTS):
  basic    — 2 класса (surface_corrosion, pipe_crack), обучена полностью; берём оба класса.
  expanded — 5 классов, обучена 2 эпохи; берём только pipe_leak, cable_insulation_damage, fastener_issue.
"""
from __future__ import annotations

import io
import json
import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

log = logging.getLogger("maintar.ai")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# Веса лежат рядом с сервисом (weights/); другой путь задаётся BASIC_WEIGHTS и EXPANDED_WEIGHTS.
WEIGHTS = Path(__file__).resolve().parent / "weights"
BASIC = Path(os.getenv("BASIC_WEIGHTS", WEIGHTS / "basic.pt"))
EXPANDED = Path(os.getenv("EXPANDED_WEIGHTS", WEIGHTS / "expanded.pt"))

# (веса, классы, которые берём из этой модели, порог уверенности)
PLAN = [
    (BASIC, {"surface_corrosion", "pipe_crack"}, float(os.getenv("BASIC_CONF", "0.35"))),
    (EXPANDED, {"pipe_leak", "cable_insulation_damage", "fastener_issue"}, float(os.getenv("EXPANDED_CONF", "0.30"))),
]

# Человеческие тексты по каждому классу модели.
TEXT = {
    "surface_corrosion": ("Видны следы коррозии на поверхности.",
                          "Очистить участок, оценить глубину коррозии, восстановить покрытие."),
    "pipe_crack": ("Видна трещина или растрескивание.",
                   "Вывести из работы до осмотра, проверить трещину неразрушающим контролем."),
    "pipe_leak": ("Видны подтёки или утечка жидкости.",
                  "Найти место утечки, проверить уплотнения и соединения, подтянуть или заменить."),
    "cable_insulation_damage": ("Изоляция кабеля повреждена или изменила цвет.",
                                "Обесточить, заменить повреждённый участок кабеля, измерить сопротивление изоляции."),
    "fastener_issue": ("Видна проблема с крепежом: коррозия, ослабление или отсутствие.",
                       "Проверить и подтянуть крепёж, заменить повреждённые элементы."),
}
# Русские названия классов модели — если у типа оборудования нет подходящего кода дефекта.
NAME = {
    "surface_corrosion": "Коррозия поверхности",
    "pipe_crack": "Трещина",
    "pipe_leak": "Утечка жидкости",
    "cable_insulation_damage": "Повреждение изоляции кабеля",
    "fastener_issue": "Проблема с крепежом",
}
# Ключевые слова кода дефекта (по типу оборудования из контекста).
CODE_KEYS = {
    "cable_insulation_damage": ["CABLE_INSULATION", "INSULATION"],
    "surface_corrosion": ["CORROSION"],
    "pipe_leak": ["LEAK"],
    "fastener_issue": ["MOUNT", "VIBRATION", "FASTEN", "BOLT"],
    "pipe_crack": ["INSULATORS", "CRACK"],
}
# Ключевые слова названия узла.
COMP_KEYS = {
    "cable_insulation_damage": ["кабел", "ввод", "клемм"],
    "surface_corrosion": ["корпус", "бак", "рама", "фланц"],
    "pipe_leak": ["шток", "сальник", "бак", "уплотн", "фланц"],
    "fastener_issue": ["крепл", "рама", "опор", "корпус"],
    "pipe_crack": ["корпус", "изолятор", "бак"],
}

_models: list[tuple] = []
_device = "cpu"


def load_models() -> None:
    global _device
    from ultralytics import YOLO
    try:
        import torch
        _device = "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:
        _device = "cpu"
    for path, keep, conf in PLAN:
        if not path.exists():
            log.error("веса не найдены: %s", path)
            continue
        m = YOLO(str(path))
        _models.append((path, m, keep, conf))
        log.info("загружены %s, классы %s, устройство %s", path.parent.parent.name, m.names, _device)


def pick_code(cls: str, defect_types: list[dict]) -> str | None:
    for key in CODE_KEYS.get(cls, []):
        for d in defect_types:
            if key in str(d.get("code", "")).upper():
                return d["code"]
    return None


def pick_component(cls: str, components: list[dict]) -> int | None:
    if not components:
        return None
    for key in COMP_KEYS.get(cls, []):
        for c in components:
            if key in str(c.get("name", "")).lower():
                return int(c["id"])
    return int(components[0]["id"])


app = FastAPI(title="MaintAR — ИИ (YOLO)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    load_models()


@app.get("/health")
def health():
    return {
        "ok": bool(_models),
        "device": _device,
        "models": [{"weights": str(p), "classes": sorted(keep), "conf": conf} for p, _, keep, conf in _models],
    }


@app.post("/analyze")
async def analyze(photo: UploadFile = File(...), context: str = Form("{}")):
    if not _models:
        raise HTTPException(status_code=503, detail="Модели не загружены")
    try:
        ctx = json.loads(context or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="context должен быть JSON")
    components = ctx.get("components") or []
    defect_types = ctx.get("defectTypes") or []

    data = await photo.read()
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось прочитать изображение")
    W, H = img.size

    t0 = time.time()
    findings = []
    for _, model, keep, conf in _models:
        res = model.predict(img, conf=conf, device=_device, verbose=False, imgsz=640)[0]
        for b in res.boxes:
            cls = model.names[int(b.cls)]
            if cls not in keep:
                continue
            score = float(b.conf)
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0])
            comp = pick_component(cls, components)
            if comp is None:
                continue
            explanation, recommendation = TEXT[cls]
            code = pick_code(cls, defect_types)
            if code is None:
                explanation = f"{NAME[cls]}. {explanation}"
            findings.append({
                "componentId": comp,
                "defectCode": code,
                "category": "PossibleDefect" if score >= 0.6 else "CheckRecommended",
                "confidence": round(score, 2),
                "explanation": explanation,
                "recommendation": recommendation,
                "box": {
                    "x": round(max(0.0, x1 / W), 4), "y": round(max(0.0, y1 / H), 4),
                    "width": round(min(1.0, (x2 - x1) / W), 4), "height": round(min(1.0, (y2 - y1) / H), 4),
                },
                "class": cls,
            })

    findings.sort(key=lambda f: -f["confidence"])
    findings = findings[:10]
    if not findings:
        findings = [{
            "componentId": int(c["id"]), "defectCode": None, "category": "NoVisibleProblems", "confidence": None,
            "explanation": "Видимых проблем не обнаружено. Предварительный осмотр, исправность не подтверждает.",
            "recommendation": None, "box": None,
        } for c in components]
    log.info("analyze %s: %d находок за %.2f c", ctx.get("equipmentType"), len(findings), time.time() - t0)
    return {"findings": findings}
