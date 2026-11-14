# Веса модели

Детектор YOLOv8. Веса обучены в репозитории [maintar-model-training](https://github.com/ilsurkhal319-cell/maintar-model-training), папка `model_training/handoff`.

| Файл | Исходный файл | Классы | Обучение | mAP50 / mAP50-95 |
|---|---|---|---|---|
| `basic.pt` | `basic/weights/best.pt` | surface_corrosion, pipe_crack | 30 эпох, полностью | 0,77 / 0,53 |
| `expanded.pt` | `expanded/weights/best.pt` | surface_corrosion, pipe_crack, pipe_leak, cable_insulation_damage, fastener_issue | 2 эпохи из 30 | 0,33 / 0,21 |

Из `expanded.pt` удалено состояние оптимизатора (`strip_optimizer`): файл уменьшился с 67 до 22,5 МБ, на распознавание это не влияет.

Сервис берёт из `basic.pt` классы коррозии и трещин, а из `expanded.pt` — утечки, изоляцию кабеля и крепёж.
Путь к весам можно переопределить переменными `BASIC_WEIGHTS` и `EXPANDED_WEIGHTS`.
