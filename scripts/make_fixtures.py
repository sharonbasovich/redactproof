#!/usr/bin/env python3
"""Generate a synthetic "screenshot" fixture for RedactProof.

All personal data is fabricated: card numbers are official test PANs,
emails use example.com, the phone number is a reserved 555 range, etc.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build() -> Image.Image:
    W, H = 1100, 640
    img = Image.new("RGB", (W, H), "#f7f8fa")
    d = ImageDraw.Draw(img)
    f_head = font(26)
    f = font(20)
    f_small = font(17)

    # fake app chrome
    d.rectangle([0, 0, W, 56], fill="#1f2733")
    d.text((24, 14), "Acme Support Console", font=f_head, fill="#e8edf2")
    d.rectangle([0, 56, 200, H], fill="#eceff3")
    for i, item in enumerate(["Tickets", "Customers", "Billing", "Reports"]):
        d.rectangle([12, 76 + i * 44, 188, 112 + i * 44], fill="#dde3ea")
        d.text((26, 86 + i * 44), item, font=f_small, fill="#33404d")

    # ticket card with synthetic PII — every value is fabricated
    d.rectangle([224, 76, 1076, 590], outline="#c9d2dc", width=2, fill="#ffffff")
    d.text((248, 96), "Ticket #4821 — Billing dispute", font=f_head, fill="#1a2430")

    lines = [
        "Customer: Jane Q. Public (SYNTHETIC)",
        "Email: jane.public@example.com",
        "Phone: (416) 555-0142",
        "Alt contact: terry.wong@example.org",
        "Card on file: 4111 1111 1111 1111  (test Visa PAN)",
        "Backup card: 5555-5555-5555-4444",
        "Billing ZIP: 94107-1234",
        "Postal code: M5V 3L9",
        "Gov ID on file: 078-05-1120 (Woolworth test SSN)",
        "Gateway IP: 203.0.113.42",
        "Session token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.SflKxwRJSMeKKF2QT4fwpMeJ",
    ]
    y = 150
    for ln in lines:
        d.text((248, y), ln, font=f, fill="#22303d")
        y += 38

    # a couple of non-sensitive lines to prove detectors don't over-fire
    y += 10
    d.text((248, y), "Order total: $1,204.55    Ref: INV-004821", font=f_small, fill="#33404d")
    d.text((248, y + 30), "Logged 2026-09-22 14:03 UTC by agent #12", font=f_small, fill="#33404d")
    return img


def main() -> None:
    img = build()
    for out in (
        os.path.join(ROOT, "fixtures", "support-ticket.png"),
        os.path.join(ROOT, "public", "demo.png"),
    ):
        img.save(out, "PNG")
        print("wrote", out)


if __name__ == "__main__":
    main()
