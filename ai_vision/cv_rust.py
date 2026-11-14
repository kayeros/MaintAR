"""
Офлайн-детектор ржавчины на классическом компьютерном зрении (без нейросети).

Работает, когда нет сети или модели: ищет области ржаво-бурого цвета с
шероховатой текстурой и возвращает рамки класса surface_corrosion.

Метод:
1. Кадр уменьшается до 320 px, переводится в HSV.
2. Маска «ржавчины»: оттенок 5–35° (оранжево-бурый), насыщенность >= 0,35,
   яркость 0,15–0,9.
3. Фильтр текстуры: локальное СКО яркости в окне 7x7 выше порога, чтобы
   отсечь ровно окрашенные оранжевые поверхности.
4. Маска делится на клетки 8x8, клетка активна при доле ржавых пикселей >= 30 %.
5. Связные области активных клеток (8-связность) площадью >= 2 % кадра
   превращаются в рамки. Уверенность растёт с плотностью и площадью, но не
   выше 0,75: это эвристика, а не обученная модель.

Ограничения: путает ржавчину с деревом, кожей рук, бурой краской; не видит
ржавчину при плохом освещении.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

CELL = 8


def _box_mean(a: np.ndarray, k: int) -> np.ndarray:
    """Среднее в окне k x k через интегральное изображение."""
    p = k // 2
    ap = np.pad(a, p, mode="edge")
    c = ap.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def rust_mask(im: Image.Image) -> np.ndarray:
    hsv = np.asarray(im.convert("HSV"), dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    color = (h >= 5) & (h <= 35) & (s >= 0.35) & (v >= 0.15) & (v <= 0.9)
    m = _box_mean(v, 7)
    std = np.sqrt(np.maximum(_box_mean(v * v, 7) - m * m, 0))
    return color & (std > 0.035)


def _components(active: np.ndarray) -> list[list[tuple[int, int]]]:
    H, W = active.shape
    seen = np.zeros_like(active, dtype=bool)
    comps = []
    for r in range(H):
        for c in range(W):
            if not active[r, c] or seen[r, c]:
                continue
            stack, cells = [(r, c)], []
            seen[r, c] = True
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < H and 0 <= nx < W and active[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            comps.append(cells)
    return comps


def detect_rust(jpeg: bytes, max_boxes: int = 3, min_area: float = 0.02) -> list[dict]:
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    im.thumbnail((320, 320))
    mask = rust_mask(im)
    H, W = mask.shape
    gh, gw = H // CELL, W // CELL
    if gh == 0 or gw == 0:
        return []
    frac = mask[:gh * CELL, :gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3))
    active = frac >= 0.30
    total = gh * gw
    out = []
    for cells in _components(active):
        area = len(cells) / total
        if area < min_area:
            continue
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        density = float(np.mean([frac[y, x] for y, x in cells]))
        conf = min(0.75, 0.35 + 0.4 * density + 0.6 * min(area, 0.25))
        out.append({
            "cls": "surface_corrosion",
            "confidence": round(conf, 2),
            "box": [x0 / gw, y0 / gh, (x1 - x0) / gw, (y1 - y0) / gh],
            "by": "cv",
            "explanation": f"Ржаво-бурая шероховатая область, около {area:.0%} кадра (офлайн-детектор по цвету и текстуре).",
        })
    out.sort(key=lambda f: -f["confidence"])
    return out[:max_boxes]


if __name__ == "__main__":
    import json
    import sys
    for p in sys.argv[1:]:
        print(p, json.dumps(detect_rust(open(p, "rb").read()), ensure_ascii=False))
