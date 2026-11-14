"""
Подбор порогов детектора на фото кейса без переобучения.

    python tune.py --weights ../models/pump_defects.pt --photos ../Кейс

Перебирает порог уверенности (общий и по классам), размер входа и TTA
(augment). Чтобы не подгонять ответ под те же фото, на которых считаем
качество, фото делятся пополам: настройки выбираются на половине A
(чётные id), качество отдельно печатается на половине B (нечётные id)
и на всех фото. Лучшие настройки пишутся в models/detector_config.json,
их подхватывает detector.py.

Метрика F1 по фото: попадание = найден хотя бы один ожидаемый класс детектора;
ложное срабатывание = выдан класс, которого нет в разметке фото.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def predict_all(model, photos: Path, rows: list[dict], imgsz: int, augment: bool) -> dict:
    """Один прогон с низким порогом: дальше пороги применяются к готовым рамкам."""
    from PIL import Image, ImageOps
    out = {}
    for r in rows:
        p = photos / r["folder"] / r["file"]
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        res = model.predict(im, conf=0.03, imgsz=imgsz, augment=augment, verbose=False)[0]
        out[r["id"]] = [(model.names[int(b.cls)], float(b.conf)) for b in res.boxes]
    return out


def score(rows, preds, known, base, class_conf):
    tp = fp = fn = tn = 0
    for r in rows:
        exp = set() if r["expected"] == "none" else set(r["expected"].split(";")) & known
        if r["expected"] != "none" and not exp:
            continue
        got = {c for c, s in preds[r["id"]] if s >= class_conf.get(c, base)}
        if exp:
            tp += bool(exp & got)
            fn += not (exp & got)
        else:
            tn += not got
        fp += len(got - exp)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return dict(f1=round(f1, 3), recall=round(rec, 3), precision=round(prec, 3), hits=tp, of=tp + fn,
                false_alarms=fp, clean_ok=tn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(HERE.parent / "models" / "pump_defects.pt"))
    ap.add_argument("--photos", default=str(HERE.parent / "Кейс"))
    ap.add_argument("--catalog", default=str(HERE.parent / "photo_catalog.csv"))
    ap.add_argument("--out", default=None, help="куда записать detector_config.json (по умолчанию рядом с весами)")
    args = ap.parse_args()

    from ultralytics import YOLO
    model = YOLO(args.weights)
    known = set(model.names.values())
    rows = list(csv.DictReader(open(args.catalog, encoding="utf-8")))
    half_a = [r for r in rows if int(r["id"]) % 2 == 0]
    half_b = [r for r in rows if int(r["id"]) % 2 == 1]
    confs = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.35]

    best = None
    report = []
    for imgsz, augment in itertools.product([640, 960], [False, True]):
        preds = predict_all(model, Path(args.photos), rows, imgsz, augment)
        for c in confs:
            s = score(half_a, preds, known, c, {})
            report.append((imgsz, augment, c, s))
            if best is None or (s["f1"], -s["false_alarms"]) > (best[3]["f1"], -best[3]["false_alarms"]):
                best = (imgsz, augment, c, s, preds)
        print(f"imgsz={imgsz} augment={augment}: " +
              ", ".join(f"{c}:{s['f1']}" for (i, a, c, s) in report if i == imgsz and a == augment))

    imgsz, augment, base, _, preds = best
    # пороги по классам: координатный спуск на половине A, только если улучшает F1
    class_conf = {}
    for cls in sorted(known):
        cur = score(half_a, preds, known, base, class_conf)["f1"]
        for c in confs:
            trial = dict(class_conf, **{cls: c})
            f = score(half_a, preds, known, base, trial)["f1"]
            if f > cur + 1e-9:
                cur, class_conf = f, trial

    res = {
        "chosen": dict(imgsz=imgsz, augment=augment, conf=base, class_conf=class_conf),
        "half_A_tuning": score(half_a, preds, known, base, class_conf),
        "half_B_holdout": score(half_b, preds, known, base, class_conf),
        "all_photos": score(rows, preds, known, base, class_conf),
        "baseline_conf_0.35_all": score(rows, predict_all(model, Path(args.photos), rows, 640, False), known, 0.35, {}),
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    out = Path(args.out) if args.out else Path(args.weights).parent
    out.mkdir(parents=True, exist_ok=True)
    (out / "detector_config.json").write_text(json.dumps(
        dict(conf=base, imgsz=imgsz, augment=augment, class_conf=class_conf), indent=1), encoding="utf-8")
    (out / "tune_report.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nНастройки записаны в {out / 'detector_config.json'}")


if __name__ == "__main__":
    main()
