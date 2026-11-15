# Веса модели

Детектор YOLOv8. Веса обучены в репозиториях [maintar-model-training](https://github.com/ilsurkhal319-cell/maintar-model-training) и [modelka](https://github.com/ilsurkhal319-cell/modelka), папка `model_training/handoff`.

| Файл | Исходный файл | Классы | Обучение | mAP50 / mAP50-95 |
|---|---|---|---|---|
| `basic.pt` | `basic/weights/best.pt` | surface_corrosion, pipe_crack | 30 эпох, полностью | 0,77 / 0,53 |
| `expanded.pt` | `handoff/expanded_v2/weights/best.pt` (modelka) | surface_corrosion, pipe_crack, pipe_leak, cable_insulation_damage, fastener_issue | дообучение на объединённом датасете, 29 эпох | 0,82 / 0,56 |

`expanded.pt` — веса `expanded_v2`: дообучение расширенной модели на объединённом датасете (дополнительные фото кабелей, крепежа, трещин и утечек). Из файла удалено состояние оптимизатора (67 → 22,5 МБ), на распознавание это не влияет.

Сервис берёт из `basic.pt` классы коррозии и трещин, а из `expanded.pt` — утечки, изоляцию кабеля и крепёж.
Путь к весам можно переопределить переменными `BASIC_WEIGHTS` и `EXPANDED_WEIGHTS`.
