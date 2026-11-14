"""
Собирает единый датасет YOLO из открытых наборов Roboflow (см. sources.py).

    ROBOFLOW_API_KEY=... python build_dataset.py --out data/merged

Шаги для каждого источника:
1. Запрос экспорта версии в формате yolov8 (если экспорт не готов, ждём).
2. Скачивание и распаковка архива в data/raw/<имя>.
3. Перевод классов источника в наши по правилам; полигоны сегментации
   превращаются в рамки; изображения без наших рамок отбрасываются.
4. Дубликаты (одинаковые файлы в разных наборах) убираются по md5.
5. Разбиение 90/10 на train/val детерминированно по хэшу файла.

Результат: data/merged/{images,labels}/{train,val}, data.yaml, stats.json,
ATTRIBUTION.md со списком источников и лицензий.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import shutil
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sources import CLASSES, SOURCES  # noqa: E402

API = "https://api.roboflow.com"
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ---------------------------------------------------------------- сеть

def _get_json(url: str) -> tuple[int, dict]:
    import requests
    r = requests.get(url, timeout=60)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {"raw": r.text[:300]}


def project_info(project: str, key: str) -> dict:
    code, j = _get_json(f"{API}/{project}?api_key={key}")
    return j.get("project", {}) if code == 200 else {}


def export_link(project: str, version: int, key: str, fmt: str = "yolov8", wait_s: int = 600) -> str:
    url = f"{API}/{project}/{version}/{fmt}?api_key={key}"
    t0 = time.time()
    while True:
        code, j = _get_json(url)
        link = (j.get("export") or {}).get("link")
        if link:
            return link
        if code not in (200, 202) or time.time() - t0 > wait_s:
            raise RuntimeError(f"экспорт {project}/{version} не получен: HTTP {code} {str(j)[:200]}")
        time.sleep(5)


def download(url: str, dst: Path) -> None:
    import requests
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dst, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)


def fetch_source(src: dict, key: str, raw_dir: Path) -> Path:
    slug = src["project"].replace("/", "__") + f"__v{src['version']}"
    out = raw_dir / slug
    if (out / "data.yaml").is_file():
        return out
    out.mkdir(parents=True, exist_ok=True)
    link = export_link(src["project"], src["version"], key)
    zpath = raw_dir / f"{slug}.zip"
    download(link, zpath)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(out)
    zpath.unlink()
    return out


# ---------------------------------------------------------------- разметка

def read_names(root: Path) -> list[str]:
    """Имена классов из data.yaml (список или словарь), без зависимости от PyYAML."""
    text = (root / "data.yaml").read_text(encoding="utf-8", errors="replace")
    try:
        import yaml
        names = yaml.safe_load(text).get("names")
    except Exception:
        m = re.search(r"names:\s*\[(.*?)\]", text, re.S)
        names = [s.strip().strip("'\"") for s in m.group(1).split(",")] if m else []
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names, key=int)]
    return [str(n) for n in names]


_NOMATCH = object()


def map_class(name: str, rules: list, explicit: bool = False):
    """Наш класс по правилам. С explicit=True различает «правило сказало None» и «ни одно правило не подошло»."""
    n = name.strip().lower()
    for pattern, target in rules:
        if re.search(pattern, n):
            return target
    return _NOMATCH if explicit else None


def line_to_box(parts: list[str]) -> tuple[float, float, float, float] | None:
    """Строка YOLO: 4 числа (cx cy w h) или полигон x1 y1 x2 y2 ... -> рамка cx cy w h."""
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 4:
        cx, cy, w, h = nums
    elif len(nums) >= 6 and len(nums) % 2 == 0:
        xs, ys = nums[0::2], nums[1::2]
        x0, x1, y0, y1 = max(0, min(xs)), min(1, max(xs)), max(0, min(ys)), min(1, max(ys))
        cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    else:
        return None
    if w <= 0.002 or h <= 0.002:
        return None
    return cx, cy, w, h


def collect(root: Path, rules: list, with_negatives: bool = False):
    """
    Пары изображение/разметка источника с переведёнными метками. С with_negatives
    вторым значением возвращаются изображения-негативы: все их рамки явно
    помечены правилом как «не дефект» (clean, Normal, затянутый болт).
    """
    names = read_names(root)
    target_idx = {c: i for i, c in enumerate(CLASSES)}
    items, negatives = [], []
    for img in root.rglob("*"):
        if img.suffix.lower() not in IMG_EXT or "images" not in img.parts:
            continue
        lab = Path(str(img.parent).replace(f"{os.sep}images", f"{os.sep}labels")) / (img.stem + ".txt")
        if not lab.is_file():
            continue
        lines, cnt = [], Counter()
        n_raw, n_explicit_neg = 0, 0
        for raw in lab.read_text(errors="replace").splitlines():
            parts = raw.split()
            if len(parts) < 5:
                continue
            try:
                name = names[int(float(parts[0]))]
            except (ValueError, IndexError):
                continue
            n_raw += 1
            target = map_class(name, rules, explicit=True)
            if target is None:
                n_explicit_neg += 1
                continue
            if target is _NOMATCH or target not in target_idx:
                continue
            box = line_to_box(parts[1:])
            if box is None:
                continue
            lines.append(f"{target_idx[target]} " + " ".join(f"{v:.6f}" for v in box))
            cnt[target] += 1
        if lines:
            items.append((img, lines, cnt))
        elif n_raw and n_explicit_neg == n_raw:
            negatives.append(img)
    return (items, negatives) if with_negatives else items


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


# ---------------------------------------------------------------- сборка

def build(out: Path, raw_dir: Path, key: str, only: list[str] | None = None, seed: int = 0) -> dict:
    rng = random.Random(seed)
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    stats = {"sources": [], "boxes": Counter(), "images": Counter()}
    attribution = ["# Источники данных", "",
                   "Наборы с Roboflow Universe. Лицензии указаны по данным Roboflow API на 13.11.2026.", "",
                   "| Проект | Версия | Лицензия | Взято изображений | Классы -> наши |", "|---|---|---|---|---|"]
    todo = [s for s in SOURCES if not only or s["project"] in only]
    # скачивание параллельно: экспорт на стороне Roboflow бывает медленным
    from concurrent.futures import ThreadPoolExecutor
    def _fetch(src):
        try:
            return src["project"], (project_info(src["project"], key), fetch_source(src, key, raw_dir)), None
        except Exception as e:
            return src["project"], None, e
    with ThreadPoolExecutor(max_workers=6) as pool:
        fetched = {name: (res, err) for name, res, err in pool.map(_fetch, todo)}
    for src in todo:
        name = src["project"]
        try:
            res, err = fetched[name]
            if err:
                raise err
            info, root = res
            items, negatives = collect(root, src["rules"], with_negatives=True)
        except Exception as e:
            print(f"[!] {name}: пропущен ({e})")
            stats["sources"].append({"project": name, "error": str(e)[:200]})
            continue
        rng.shuffle(items)
        taken, cnt = 0, Counter()
        for img, lines, c in items:
            if taken >= src["cap"]:
                break
            h = md5(img)
            if h in seen:
                continue
            seen.add(h)
            split = "val" if int(h[:2], 16) < 26 else "train"  # ~10 %
            stem = f"{name.replace('/', '__')}__{h[:10]}"
            shutil.copy2(img, out / "images" / split / f"{stem}{img.suffix.lower()}")
            (out / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + "\n")
            stats["images"][split] += 1
            cnt.update(c)
            taken += 1
            # редкие классы дублируются в train (val не трогаем, чтобы метрики были честными)
            for k in range(1, src.get("repeat", 1) if split == "train" else 1):
                shutil.copy2(img, out / "images" / split / f"{stem}_r{k}{img.suffix.lower()}")
                (out / "labels" / split / f"{stem}_r{k}.txt").write_text("\n".join(lines) + "\n")
                stats["images"]["train_repeats"] += 1
        # негативы: изображения без дефектов, учат модель не срабатывать на чистом металле
        rng.shuffle(negatives)
        neg_taken = 0
        for img in negatives:
            if neg_taken >= src.get("negatives", 0):
                break
            h = md5(img)
            if h in seen:
                continue
            seen.add(h)
            split = "val" if int(h[:2], 16) < 26 else "train"
            stem = f"{name.replace('/', '__')}__neg_{h[:10]}"
            shutil.copy2(img, out / "images" / split / f"{stem}{img.suffix.lower()}")
            (out / "labels" / split / f"{stem}.txt").write_text("")
            stats["images"]["negatives"] += 1
            neg_taken += 1
        stats["boxes"].update(cnt)
        mapping = ", ".join(f"{k}: {v}" for k, v in sorted(cnt.items()))
        stats["sources"].append({"project": name, "version": src["version"], "images": taken,
                                 "available": len(items), "boxes": dict(cnt), "license": info.get("license")})
        attribution.append(f"| [{name}](https://universe.roboflow.com/{name}) | {src['version']} | "
                           f"{info.get('license', '?')} | {taken} | {mapping} |")
        print(f"[+] {name}: взято {taken} из {len(items)} подходящих, рамки {dict(cnt)}")

    used = [c for c in CLASSES]
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: images/train\nval: images/val\n"
        f"nc: {len(used)}\nnames: {json.dumps(used)}\n", encoding="utf-8")
    stats["boxes"] = dict(stats["boxes"])
    stats["images"] = dict(stats["images"])
    (out / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "ATTRIBUTION.md").write_text("\n".join(attribution) + "\n", encoding="utf-8")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "data" / "merged"))
    ap.add_argument("--raw", default=str(HERE / "data" / "raw"))
    ap.add_argument("--only", nargs="*", help="только эти проекты (для отладки)")
    args = ap.parse_args()
    key = os.getenv("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("Задайте ROBOFLOW_API_KEY")
    stats = build(Path(args.out), Path(args.raw), key, args.only)
    print("\nИтого изображений:", stats["images"])
    print("Рамок по классам:", json.dumps(stats["boxes"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
