"""
Обучение детектора дефектов YOLO на собранном датасете.

    python train_yolo.py --data data/merged/data.yaml --model yolov8s.pt --epochs 40

Результат: runs/pump_defects/weights/best.pt и копия в ../models/pump_defects.pt,
метрики по классам в runs/pump_defects/metrics_by_class.md.
Нужна видеокарта: на T4 (Google Colab) около часа на ~10 тыс. изображений.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "data" / "merged" / "data.yaml"))
    ap.add_argument("--model", default="yolov8s.pt")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--project", default=str(HERE / "runs"))
    ap.add_argument("--name", default="pump_defects")
    args = ap.parse_args()

    from ultralytics import YOLO
    model = YOLO(args.model)
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                project=args.project, name=args.name, exist_ok=True, patience=12,
                cos_lr=True, close_mosaic=5, plots=True, workers=4, seed=0)

    run = Path(args.project) / args.name
    best = run / "weights" / "best.pt"
    metrics = YOLO(str(best)).val(data=args.data, imgsz=args.imgsz, split="val", verbose=False,
                                 project=args.project, name=args.name + "_val", exist_ok=True)
    names = metrics.names
    rows = ["| Класс | Precision | Recall | mAP50 | mAP50-95 |", "|---|---|---|---|---|"]
    by_class = {}
    for i, c in enumerate(metrics.box.ap_class_index):
        p, r, ap50, ap = metrics.box.class_result(i)
        by_class[names[int(c)]] = dict(precision=round(p, 3), recall=round(r, 3), map50=round(ap50, 3), map=round(ap, 3))
        rows.append(f"| {names[int(c)]} | {p:.2f} | {r:.2f} | {ap50:.2f} | {ap:.2f} |")
    rows.append(f"| **все** | {metrics.box.mp:.2f} | {metrics.box.mr:.2f} | {metrics.box.map50:.2f} | {metrics.box.map:.2f} |")
    (run / "metrics_by_class.md").write_text(
        "# Детектор на валидационной части открытых данных\n\n" + "\n".join(rows) + "\n", encoding="utf-8")
    (run / "metrics_by_class.json").write_text(json.dumps(by_class, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n".join(rows))

    dst = HERE.parent / "models"
    dst.mkdir(exist_ok=True)
    shutil.copy2(best, dst / "pump_defects.pt")
    print(f"\nВеса: {dst / 'pump_defects.pt'}")


if __name__ == "__main__":
    main()
