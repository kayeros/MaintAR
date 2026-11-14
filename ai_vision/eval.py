"""
Проверка качества /analyze на размеченных фото кейса.

    python eval.py --photos "../Кейс"                       # текущий провайдер
    python eval.py --photos "../Кейс" --provider offline    # только классическое CV
    python eval.py --photos "../Кейс" --clean               # без водяных знаков и дубликатов

Метрики (их можно нести в презентацию):
- «Попадание по фото»: для фото с дефектом модель назвала хотя бы один из
  ожидаемых классов; для фото без видимого дефекта (expected = none) модель
  не выдала ни одной находки.
- По классам: полнота (на скольких фото с этим классом он найден) и число
  ложных срабатываний (класс выдан там, где его нет в разметке).

Демо-кэш при проверке выключен, чтобы не завышать цифры. Ответы модели
кэшируются, повторный прогон бесплатный.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", default=str(HERE.parent / "Кейс"), help="папка Кейс")
    ap.add_argument("--catalog", default=str(HERE / "photo_catalog.csv"))
    ap.add_argument("--provider", default=None, help="anthropic | openai | offline")
    ap.add_argument("--clean", action="store_true", help="пропустить фото с водяными знаками и дубликаты")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=str(HERE / "eval_out"))
    ap.add_argument("--known-only", action="store_true",
                    help="считать только классы, которые умеет выдавать детектор (честная оценка YOLO)")
    args = ap.parse_args()

    if args.provider:
        os.environ["VISION_PROVIDER"] = args.provider
    from vision import analyze_image, provider_config  # после установки провайдера
    cfg = provider_config()

    known = None
    if args.known_only:
        import detector
        known = set(detector.classes())
        if not known:
            sys.exit("--known-only: детектор не загружен")
    rows = list(csv.DictReader(open(args.catalog, encoding="utf-8")))
    if args.clean:
        rows = [r for r in rows if not any(t in r["flags"] for t in ("watermark", "duplicate_of"))]
    if args.limit:
        rows = rows[:args.limit]

    out = Path(args.out)
    out.mkdir(exist_ok=True)
    per_class = defaultdict(lambda: {"n": 0, "found": 0, "fp": 0})
    results, hits, errors = [], 0, 0
    for i, r in enumerate(rows, 1):
        p = Path(args.photos) / r["folder"] / r["file"]
        if not p.is_file():
            print(f"нет файла {p}", file=sys.stderr)
            continue
        resp = analyze_image(p.read_bytes(), use_demo_cache=False)
        if resp.get("error"):
            errors += 1
        expected = set() if r["expected"] == "none" else set(r["expected"].split(";"))
        if known is not None and expected:
            expected &= known
            if not expected:
                continue  # дефект из класса, которого детектор не знает
        predicted = {f["cls"] for f in resp["findings"]}
        hit = bool(expected & predicted) if expected else not predicted
        hits += hit
        if not expected:
            per_class["none"]["n"] += 1
            per_class["none"]["found"] += not predicted
        for c in expected:
            per_class[c]["n"] += 1
            per_class[c]["found"] += c in predicted
        for c in predicted - expected:
            per_class[c]["fp"] += 1
        results.append({"id": r["id"], "file": f"{r['folder']}/{r['file']}", "expected": r["expected"],
                        "predicted": ";".join(sorted(predicted)) or "none", "hit": int(hit),
                        "source": resp.get("source"), "error": resp.get("error", ""),
                        "equipment": resp.get("equipment", "")})
        (out / f"{r['id']}.json").write_text(json.dumps(resp, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[{i}/{len(rows)}] {'+' if hit else '-'} {r['file'][:40]:40s} ждали {r['expected']:45s} получили {results[-1]['predicted']}")

    n = len(results)
    with open(out / "eval_results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()) if results else ["id"])
        w.writeheader()
        w.writerows(results)

    lines = [f"# Оценка /analyze: {cfg['provider']} / {cfg['model']}", "",
             f"Фото: {n}{' (без водяных знаков и дубликатов)' if args.clean else ''}"
             f"{' (только классы детектора и фото без дефектов)' if known else ''}. "
             f"Попадание по фото: **{hits}/{n} = {hits / max(n, 1):.0%}**. Ошибок вызова модели: {errors}.", "",
             "| Класс | Фото с классом | Найдено | Полнота | Ложные срабатывания |",
             "|---|---|---|---|---|"]
    for c in sorted(per_class, key=lambda c: (-per_class[c]["n"], c)):
        d = per_class[c]
        rec = f"{d['found'] / d['n']:.0%}" if d["n"] else "—"
        lines.append(f"| {c} | {d['n']} | {d['found']} | {rec} | {d['fp']} |")
    lines += ["", "«none» означает фото без внешне видимого дефекта из списка (внутренние дефекты, исправные узлы): "
              "попадание засчитывается, если модель ничего не нашла.",
              "Классов grounding_missing и indicator_mismatch в фото кейса нет, их качество не проверено."]
    (out / "eval_summary.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n" + "\n".join(lines))
    print(f"\nПодробно: {out / 'eval_results.csv'}, ответы по фото: {out}/<id>.json")


if __name__ == "__main__":
    main()
