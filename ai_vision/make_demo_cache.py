"""
Собирает demo_cache/demo.json: эталонные ответы для показательных фото кейса.
Рамки и тексты размечены вручную по фото (это не вывод модели), ответ
проходит ту же проверку validate(), что и ответ модели.

    python make_demo_cache.py --photos "../Кейс"
"""
import argparse, hashlib, json
from pathlib import Path
from vision import dhash, validate

HERE = Path(__file__).resolve().parent
DEMO = {
 "Насосные агрегаты/60cb39e72d7e4bc38d47e945b66900f8.png": {
  "equipment": "центробежный насос, узел уплотнения вала",
  "findings": [{"cls": "shaft_seal_leak", "confidence": 0.9, "box": [0.43, 0.30, 0.17, 0.66],
                "explanation": "Капли и потёки масла стекают из-под крышки уплотнения вниз по корпусу."}],
  "nodes": [{"comp": "seal", "box": [0.39, 0.25, 0.23, 0.42]}, {"comp": "casing", "box": [0.08, 0.0, 0.70, 1.0]},
            {"comp": "bearing", "box": [0.30, 0.17, 0.38, 0.55]}]},
 "Насосные агрегаты/Сниимок.PNG": {
  "equipment": "насос, сальниковая камера вала",
  "findings": [{"cls": "seal_overheat", "confidence": 0.85, "box": [0.42, 0.0, 0.30, 0.55],
                "explanation": "Над сальниковой камерой поднимается дым, металл вокруг потемнел."},
               {"cls": "surface_corrosion", "confidence": 0.6, "box": [0.0, 0.0, 0.35, 0.75],
                "explanation": "Краска корпуса шелушится, видны очаги ржавчины."}],
  "nodes": [{"comp": "seal", "box": [0.40, 0.25, 0.32, 0.75]}, {"comp": "casing", "box": [0.0, 0.0, 0.45, 1.0]}]},
 "ЭД/65d7bec338d641b8ab2a8718af266a74.png": {
  "equipment": "асинхронный электродвигатель, оребрённый корпус",
  "findings": [{"cls": "cooling_fins_damage", "confidence": 0.9, "box": [0.27, 0.22, 0.38, 0.55],
                "explanation": "Группа рёбер охлаждения сломана и загнута, внутри скопилась грязь."},
               {"cls": "surface_corrosion", "confidence": 0.55, "box": [0.15, 0.28, 0.30, 0.65],
                "explanation": "На кромке корпуса облупилась краска, видна ржавчина."}],
  "nodes": [{"comp": "motor", "box": [0.10, 0.0, 0.88, 1.0]}]},
 "Насосные агрегаты/16c811b0db124c77b276a1a06bc1d3fb.png": {
  "equipment": "клеммная коробка электродвигателя",
  "findings": [{"cls": "terminal_overheat", "confidence": 0.9, "box": [0.43, 0.17, 0.38, 0.40],
                "explanation": "Клеммы и колодка покрыты нагаром, видны потёки оплавленного материала."},
               {"cls": "cable_insulation_damage", "confidence": 0.88, "box": [0.12, 0.45, 0.48, 0.45],
                "explanation": "Оболочка кабелей обуглена и потрескалась, у клемм оголены медные жилы."}],
  "nodes": [{"comp": "terminal", "box": [0.06, 0.05, 0.86, 0.88]}]},
 "Насосные агрегаты/6bd1015378aa4382aedc45fe4b7adda4.png": {
  "equipment": "опорная рама агрегата и фундамент",
  "findings": [{"cls": "frame_corrosion_loose_bolts", "confidence": 0.85, "box": [0.05, 0.0, 0.88, 0.82],
                "explanation": "Рама сплошь в ржавчине, у фундаментных болтов коррозия, на бетоне тёмные пятна."}],
  "nodes": [{"comp": "frame", "box": [0.05, 0.0, 0.88, 0.82]}]},
 "Трубопровод/Photo-9-Mechanically-Damaged-Insulation-on-Chilled-Water-Pipe.jpg": {
  "equipment": "изолированные трубопроводы",
  "findings": [{"cls": "insulation_damage", "confidence": 0.92, "box": [0.25, 0.18, 0.47, 0.55],
                "explanation": "Защитное покрытие изоляции разорвано, видна минеральная вата, фольга отслоилась."}],
  "nodes": [{"comp": "piping", "box": [0.25, 0.0, 0.65, 1.0]}]},
 "ЭД/81316b33970247cdbc980ceccd88cb9a.png": {
  "equipment": "электродвигатель, подшипниковый щит",
  "findings": [{"cls": "overheat_discoloration", "confidence": 0.8, "box": [0.20, 0.20, 0.55, 0.55],
                "explanation": "Вокруг подшипникового узла краска побурела и пожелтела кольцом, признак нагрева."},
               {"cls": "surface_corrosion", "confidence": 0.6, "box": [0.15, 0.15, 0.62, 0.65],
                "explanation": "Краска щита шелушится, под ней ржавчина."}],
  "nodes": [{"comp": "bearing", "box": [0.37, 0.37, 0.24, 0.24]}, {"comp": "motor", "box": [0.03, 0.03, 0.94, 0.90]}]},
}

ap = argparse.ArgumentParser(); ap.add_argument("--photos", default=str(HERE.parent / "Кейс")); a = ap.parse_args()
items = []
for rel, raw in DEMO.items():
    data = (Path(a.photos) / rel).read_bytes()
    for f in raw["findings"]:
        f["by"] = "reference"
    resp, dropped = validate(raw)
    assert not dropped, (rel, dropped)
    items.append({"file": rel, "dhash": f"{dhash(data):016x}", "sha256": hashlib.sha256(data).hexdigest(),
                  "response": resp})
(HERE / "demo_cache").mkdir(exist_ok=True)
(HERE / "demo_cache" / "demo.json").write_text(json.dumps({"note": "Эталонные ответы, размечены вручную. Используются, если модель недоступна или VISION_DEMO_MODE=1.", "items": items}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"demo.json: {len(items)} фото")
