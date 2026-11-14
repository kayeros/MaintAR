"""Проверки сервиса без настоящей модели: справочники, нормализация рамок, контракт /analyze.
Запуск: .venv\\Scripts\\python -m pytest -q  (или просто python test_app.py)
"""
import json
from pathlib import Path

from fastapi.testclient import TestClient

import app as svc

SAMPLE = Path(__file__).resolve().parent.parent / "assets/samples/term.jpg"


def test_reference_data():
    assert len(svc.CLASS_SET) == 18
    assert {"CN-1", "AMS-21031004-1"} <= set(svc.UNITS)
    assert {c["comp"] for c in svc.UNITS["CN-1"]} >= {"seal", "terminal", "bearing"}


def test_norm_box_formats():
    W, H = 1000, 500
    assert svc.norm_box([100, 50, 300, 250], W, H) == [0.1, 0.1, 0.2, 0.4]          # пиксели xyxy
    assert svc.norm_box([0.1, 0.1, 0.3, 0.5], W, H) == [0.1, 0.1, 0.2, 0.4]          # доли xyxy
    assert svc.norm_box([100, 200, 300, 600], 400, 300) == [0.1, 0.2, 0.2, 0.4]      # 0..1000
    assert svc.norm_box([0.5, 0.5, 0.2, 0.2], W, H) == [0.5, 0.5, 0.2, 0.2]          # доли xywh
    assert svc.norm_box([0.9, 0.9, 0.5, 0.5], W, H) == [0.9, 0.9, 0.1, 0.1]          # обрезка в кадр
    assert svc.norm_box("плохо", W, H) is None
    assert svc.norm_box([1, 2, 3], W, H) is None


def test_analyze_contract(monkeypatch):
    def fake(prompt, b64):
        assert "shaft_seal_leak" in prompt and len(b64) > 100
        return json.dumps({
            "equipment": "клеммная коробка",
            "findings": [
                {"cls": "terminal_overheat", "confidence": 0.82, "box": [150, 200, 350, 400], "explanation": "Потемнение клемм"},
                {"cls": "unknown_class", "confidence": 0.9, "box": [0, 0, 10, 10], "explanation": "чужой класс"},
                {"cls": "pipe_crack", "confidence": 0.2, "box": [0, 0, 100, 100], "explanation": "низкая уверенность"},
            ],
            "nodes": [{"comp": "terminal", "box": [50, 50, 800, 600]}],
        })

    monkeypatch.setitem(svc.ASK, svc.PROVIDER, fake)
    client = TestClient(svc.app)
    with open(SAMPLE, "rb") as f:
        r = client.post("/analyze", files={"photo": ("term.jpg", f, "image/jpeg")}, data={"unit_id": "CN-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [f["cls"] for f in body["findings"]] == ["terminal_overheat"]
    x, y, w, h = body["findings"][0]["box"]
    assert 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1
    assert body["nodes"][0]["comp"] == "terminal"


def test_retry_on_bad_json(monkeypatch):
    answers = iter(["это не json", json.dumps({"equipment": "насос", "findings": [], "nodes": []})])
    monkeypatch.setitem(svc.ASK, svc.PROVIDER, lambda p, b: next(answers))
    with open(SAMPLE, "rb") as f:
        r = TestClient(svc.app).post("/analyze", files={"photo": ("t.jpg", f, "image/jpeg")})
    assert r.status_code == 200 and r.json()["findings"] == []


def test_bad_image():
    r = TestClient(svc.app).post("/analyze", files={"photo": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400
