import os
import shutil
import yaml
from pathlib import Path
from collections import defaultdict
import random

# ====================== НАСТРОЙКИ ======================
BASE = Path("data")
OUTPUT = BASE / "expanded_v2"
EXISTING = BASE / "expanded_handoff"          # старый датасет (можно None)

# Новые датасеты, которые ты скачал
NEW_DATASETS = [
    BASE / "cable damage.v2-release.yolov8",
    BASE / "Fastener defect detection.v1i.yolov8",
    BASE / "Pipe Crack Detection.v8-pipe-crack.yolov8",
    BASE / "pipe-crack-detection.v1i.yolov8",
    BASE / "pipe-leak.v1i.yolov8",
    BASE / "Steel-Loose Bolt.v2-steel-loose-v1.yolov8",
]

# Маппинг классов из новых датасетов → твои 5 классов
# Ключ = точное имя класса из data.yaml датасета (в нижнем регистре)
CLASS_MAP = {
    # cable
    "break": 3,
    "thunderbolt": 3,
    "cable-damage": 3,
    "damage": 3,
    "damaged": 3,

    # fastener
    "loose": 4,
    "bolt_loose": 4,
    "nut_loose": 4,
    "head_loose": 4,
    "fastener_broken": 4,
    "fastener2_broken": 4,
    "missing": 4,
    "no_bolt": 4,
    "no_nut": 4,

    # pipe crack
    "crack": 1,
    "pipe_crack": 1,
    "cracks": 1,

    # pipe leak
    "leak": 2,
    "pipe_leak": 2,
    "water": 2,
    "leakage": 2,

    # corrosion (если вдруг есть)
    "corrosion": 0,
    "rust": 0,
    "corroded": 0,
}

TARGET_NAMES = {
    0: "surface_corrosion",
    1: "pipe_crack",
    2: "pipe_leak",
    3: "cable_insulation_damage",
    4: "fastener_issue",
}

VAL_RATIO = 0.15
SEED = 42
# =======================================================


def get_class_map_from_yaml(yaml_path):
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    names = data.get("names", {})
    if isinstance(names, list):
        return {i: name for i, name in enumerate(names)}
    return {int(k): v for k, v in names.items()}


def convert_label_line(line, old_names, class_map):
    parts = line.strip().split()
    if not parts:
        return None
    old_id = int(parts[0])
    old_name = old_names.get(old_id, "").lower().strip()
    
    new_id = class_map.get(old_name)
    if new_id is None:
        # пробуем частичное совпадение
        for key, val in class_map.items():
            if key in old_name or old_name in key:
                new_id = val
                break
    if new_id is None:
        return None  # класс не нужен — пропускаем
    
    return f"{new_id} {' '.join(parts[1:])}"


def collect_from_dataset(ds_path):
    yaml_path = ds_path / "data.yaml"
    if not yaml_path.exists():
        print(f"[!] Нет data.yaml в {ds_path.name}")
        return []

    old_names = get_class_map_from_yaml(yaml_path)
    print(f"\n=== {ds_path.name} ===")
    print("Классы:", old_names)

    items = []
    for split in ["train", "valid", "val", "test"]:
        img_dir = ds_path / "images" / split
        lbl_dir = ds_path / "labels" / split
        if not img_dir.exists():
            img_dir = ds_path / split / "images"
            lbl_dir = ds_path / split / "labels"
        if not img_dir.exists():
            continue

        for img_file in img_dir.glob("*"):
            if img_file.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
                continue
            lbl_file = lbl_dir / (img_file.stem + ".txt")
            items.append((img_file, lbl_file if lbl_file.exists() else None, old_names))
    return items


def main():
    random.seed(SEED)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for split in ["train", "val"]:
        (OUTPUT / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT / "labels" / split).mkdir(parents=True, exist_ok=True)

    all_items = []

    # 1. Старый датасет
    if EXISTING and EXISTING.exists():
        print("Добавляю старый expanded_handoff...")
        for split in ["train", "val"]:
            img_dir = EXISTING / "images" / split
            lbl_dir = EXISTING / "labels" / split
            if not img_dir.exists():
                continue
            for img in img_dir.glob("*"):
                lbl = lbl_dir / (img.stem + ".txt")
                all_items.append((img, lbl if lbl.exists() else None, None, split))

    # 2. Новые датасеты
    for ds in NEW_DATASETS:
        if not ds.exists():
            print(f"[!] Не найден: {ds}")
            continue
        items = collect_from_dataset(ds)
        for img, lbl, old_names in items:
            all_items.append((img, lbl, old_names, None))

    print(f"\nВсего изображений собрано: {len(all_items)}")

    # Перемешиваем и делим
    random.shuffle(all_items)
    val_count = int(len(all_items) * VAL_RATIO)
    val_items = all_items[:val_count]
    train_items = all_items[val_count:]

    stats = defaultdict(int)

    def process(items, split):
        for img_path, lbl_path, old_names, forced_split in items:
            split_name = forced_split or split
            new_img_name = f"{img_path.parent.parent.name}_{img_path.name}"
            new_img = OUTPUT / "images" / split_name / new_img_name
            new_lbl = OUTPUT / "labels" / split_name / (Path(new_img_name).stem + ".txt")

            shutil.copy2(img_path, new_img)

            if lbl_path is None or not lbl_path.exists():
                new_lbl.write_text("")  # negative sample
                continue

            if old_names is None:
                # старый датасет — просто копируем
                shutil.copy2(lbl_path, new_lbl)
                continue

            new_lines = []
            for line in lbl_path.read_text(encoding="utf-8").splitlines():
                converted = convert_label_line(line, old_names, CLASS_MAP)
                if converted:
                    new_lines.append(converted)
                    stats[TARGET_NAMES[int(converted.split()[0])]] += 1
            new_lbl.write_text("\n".join(new_lines) + ("\n" if new_lines else ""))

    process(train_items, "train")
    process(val_items, "val")

    # data.yaml
    data_yaml = {
        "path": str(OUTPUT.resolve()),
        "train": "images/train",
        "val": "images/val",
        "names": TARGET_NAMES,
        "nc": 5,
    }
    with open(OUTPUT / "data.yaml", "w", encoding="utf-8") as f:
        yaml.dump(data_yaml, f, allow_unicode=True, sort_keys=False)

    print("\n=== Готово ===")
    print(f"Результат: {OUTPUT}")
    print("Статистика объектов по классам:")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()