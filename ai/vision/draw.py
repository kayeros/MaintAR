"""Рисует рамки ответа /analyze поверх фото (для проверки и слайдов).
    python draw.py фото.jpg ответ.json [выход.jpg]"""
import io, json, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

COLORS = {"defect": (229, 57, 53), "check": (251, 192, 45), "ok": (67, 160, 71)}


def draw(img_bytes: bytes, resp: dict, max_side: int = 1000) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(img_bytes))).convert("RGB")
    im.thumbnail((max_side, max_side))
    W, H = im.size
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", max(14, W // 45))
    except OSError:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(14, W // 45))
        except OSError:
            font = ImageFont.load_default()
    for n in resp.get("nodes", []):
        x, y, w, h = n["box"]
        d.rectangle([x * W, y * H, (x + w) * W, (y + h) * H], outline=(120, 180, 255), width=2)
        d.text((x * W + 4, (y + h) * H - font.size - 4), n.get("name", n["comp"]), fill=(120, 180, 255), font=font)
    for f in resp.get("findings", []):
        x, y, w, h = f["box"]
        c = COLORS.get(f.get("status", "check"), COLORS["check"])
        d.rectangle([x * W, y * H, (x + w) * W, (y + h) * H], outline=c, width=max(3, W // 200))
        label = f"{f.get('name', f['cls'])} {f['confidence']:.0%}"
        tb = d.textbbox((0, 0), label, font=font)
        ty = max(0, y * H - (tb[3] - tb[1]) - 8)
        d.rectangle([x * W, ty, x * W + tb[2] + 8, ty + tb[3] + 6], fill=c)
        d.text((x * W + 4, ty + 2), label, fill=(0, 0, 0), font=font)
    return im


if __name__ == "__main__":
    img = open(sys.argv[1], "rb").read()
    resp = json.load(open(sys.argv[2], encoding="utf-8"))
    draw(img, resp).save(sys.argv[3] if len(sys.argv) > 3 else "overlay.jpg", quality=88)
