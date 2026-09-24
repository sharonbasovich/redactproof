#!/usr/bin/env python3
"""Generate synthetic fixtures for the RedactProof red-team engine.

Every value is fabricated: test PANs, example.com emails, reserved 555
phone numbers, the Woolworth specimen SSN, TEST-NET-3 IPs.

Each fixture starts from the same base document containing one PII line
per detector category, then applies a different "bad redaction" over the
PII lines so tests can measure what each attack actually recovers:

  clean.png            no redaction (identity pass should find everything)
  marker-55.png        translucent black marker at ~55% opacity
  marker-75.png        translucent black marker at ~75% opacity
  marker-opaque.png    opaque black boxes (control: nothing recoverable)
  marker-yellow.png    solid yellow highlighter blocks
  blur.png             gaussian blur over PII lines
  pixelate.png         nearest-neighbour pixelation over PII lines
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fixtures", "redteam")

W, H = 980, 560
# (text, y) — y is the text baseline top; the redaction box covers it.
LINES = [
    ("Email: redteam.alice@example.com", "email"),
    ("Phone: (416) 555-0177", "phone"),
    ("Card: 4111 1111 1111 1111", "payment-card"),
    ("SSN: 078-05-1120", "ssn"),
    ("ZIP: 94107-1234", "postal-code"),
    ("IP: 203.0.113.99", "ipv4"),
]
LINE_H = 44
TEXT_X = 60
TEXT_Y0 = 120


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def base() -> Image.Image:
    img = Image.new("RGB", (W, H), "#f5f6f8")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 64], fill="#26303d")
    d.text((24, 18), "Acme Claims Portal — customer record", font=font(24),
           fill="#e8edf2")
    d.rectangle([32, 88, W - 32, H - 32], outline="#c9d2dc", width=2,
                fill="#ffffff")
    d.text((TEXT_X, 96), "Sensitive fields", font=font(18), fill="#5a6b7d")
    f = font(24)
    for i, (text, _cat) in enumerate(LINES):
        d.text((TEXT_X, TEXT_Y0 + i * LINE_H), text, font=f, fill="#1c2733")
    return img


def line_box(i: int):
    return (TEXT_X - 8, TEXT_Y0 + i * LINE_H - 4, W - 48,
            TEXT_Y0 + i * LINE_H + LINE_H - 8)


def translucent_marker(img: Image.Image, alpha: int) -> Image.Image:
    img = img.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for i in range(len(LINES)):
        d.rounded_rectangle(line_box(i), radius=6, fill=(10, 10, 12, alpha))
    return Image.alpha_composite(img, overlay).convert("RGB")


def opaque_marker(img: Image.Image) -> Image.Image:
    d = ImageDraw.Draw(img)
    for i in range(len(LINES)):
        d.rectangle(line_box(i), fill="#000000")
    return img


def yellow_marker(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for i in range(len(LINES)):
        # translucent saturated yellow — a real highlighter keeps the
        # strokes (mostly) but kills the blue channel, which is what
        # channel-max exists to defeat
        d.rectangle(line_box(i), fill=(255, 235, 0, 150))
    return Image.alpha_composite(img, overlay).convert("RGB")


def blur_regions(img: Image.Image, radius: float) -> Image.Image:
    img = img.copy()
    for i in range(len(LINES)):
        box = line_box(i)
        patch = img.crop(box).filter(ImageFilter.GaussianBlur(radius))
        img.paste(patch, box)
    return img


def pixelate_regions(img: Image.Image, factor: int) -> Image.Image:
    img = img.copy()
    for i in range(len(LINES)):
        box = line_box(i)
        patch = img.crop(box)
        small = patch.resize(
            (max(1, patch.width // factor), max(1, patch.height // factor)),
            Image.BILINEAR,
        )
        img.paste(small.resize(patch.size, Image.NEAREST), box)
    return img


def save(img: Image.Image, name: str) -> None:
    img.save(os.path.join(OUT, name), "PNG")
    print(f"wrote {name} {img.size[0]}x{img.size[1]}")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    save(base(), "clean.png")
    save(translucent_marker(base(), 140), "marker-55.png")
    save(translucent_marker(base(), 190), "marker-75.png")
    save(opaque_marker(base()), "marker-opaque.png")
    save(yellow_marker(base()), "marker-yellow.png")
    save(blur_regions(base(), 4), "blur.png")
    save(pixelate_regions(base(), 8), "pixelate.png")


if __name__ == "__main__":
    main()
