# Веса модели

Детектор YOLOv8. Веса обучены в репозитории [maintar-model-training](https://github.com/ilsurkhal319-cell/maintar-model-training), папка `model_training/handoff`.

| Файл | Исходный файл | Классы | Обучение | mAP50 / mAP50-95 |
|---|---|---|---|---|
| `basic.pt` | `basic/weights/best.pt` | surface_corrosion, pipe_crack | 30 эпох, полностью | 0,77 / 0,53 |
| `expanded.pt` | `runs/expanded_resume_batch32/weights/best.pt` | surface_corrosion, pipe_crack, pipe_leak, cable_insulation_damage, fastener_issue | 30 эпох, полностью | 0,64 / 0,41 |

`expanded.pt` — лучшие веса дообучения `expanded_resume_batch32` (продолжение с 3-й эпохи до 30-й, batch 32).

Сервис берёт из `basic.pt` классы коррозии и трещин, а из `expanded.pt` — утечки, изоляцию кабеля и крепёж.
Путь к весам можно переопределить переменными `BASIC_WEIGHTS` и `EXPANDED_WEIGHTS`.

## Следующее дообучение (в работе)

В `maintar-model-training` (коммит `414a369`, 15.11.2026) подготовлено дообучение расширенной модели на дополнительных данных. Новых весов в нём пока нет, поэтому `basic.pt` и `expanded.pt` не менялись.

- `ai/vision/train/merge_datasets.py` — скрипт, который сливает шесть дополнительных датасетов (повреждения кабеля, крепёж, трещины и утечки труб, ослабленные болты) с текущим набором и приводит их классы к нашим пяти.
- `ai/vision/train/runs/expanded_resume_batch24/` — параметры запуска (`args.yaml`, `handoff_run.json`) и распределение меток (`labels.jpg`): продолжение обучения `expanded` с `last.pt`, 30 эпох, batch 24.

Когда появится `runs/expanded_resume_batch24/weights/best.pt`, им нужно заменить `expanded.pt`.
