#!/usr/bin/env python3
"""Update the D&D rate-list logo and the first nine rates.

The source PDF is a layered Photoshop export. The script keeps every original
PDF image stream intact and overlays lossless RGB patches for:
  * the header logo,
  * the background watermark,
  * the changed digits in rates 1-9.

Run from the repository root:
    .venv/bin/python scripts/update_dnd_rate_list.py
"""
from pathlib import Path
import json

import pymupdf
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "rate-list"
SOURCE = ASSETS / "original.pdf"
LOGO = ASSETS / "logo.jpeg"
OUTPUT = ASSETS / "D&D-Rate-List-Updated.pdf"

# Coordinates are in a 2550 x 4200 pixel canvas (300 dpi).
HEADER_EDIT = (675, 0, 1875, 455)
WATERMARK_EDIT = (350, 1450, 2200, 2450)
PAGE_CENTER_X = 1275
PX_TO_PT = 612 / 2550  # also 1008 / 4200

NEW_RATES = {
    1: "2,000",
    2: "2,200",
    3: "2,200",
    4: "2,400",
    5: "2,400",
    6: "2,300",
    7: "2,500",
    8: "2,500",
    9: "2,800",
}

# Top of the digit ink for each of the first nine rows.
ROW_TOP = {1: 519, 2: 657, 3: 795, 4: 934, 5: 1072, 6: 1211, 7: 1350, 8: 1488, 9: 1627}

# Glyphs harvested from the original PDF so replacement digits match the font.
GLYPH_BOX = {
    "0": (327, 657, 360, 707),
    "2": (228, 657, 261, 707),
    "3": (288, 1349, 321, 1400),
    "4": (227, 2457, 262, 2507),
    "5": (288, 2458, 321, 2508),
    "8": (288, 3565, 321, 3616),
}


def clean_logo_background(image: Image.Image) -> Image.Image:
    """Turn the JPEG's near-white background pure white; retain logo colors."""
    image = image.convert("RGB")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = pixels[x, y]
            if min(r, g, b) >= 246:
                pixels[x, y] = (255, 255, 255)
    return image


def fit_width(image: Image.Image, width: int) -> Image.Image:
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def paste_centered(canvas: Image.Image, image: Image.Image, top: int) -> None:
    canvas.paste(image, (PAGE_CENTER_X - image.width // 2, top))


def remove_pink_watermark(image: Image.Image) -> None:
    """Remove only the pale pink mark, preserving dark rate-table lettering."""
    pixels = image.load()
    x0, y0, x1, y1 = WATERMARK_EDIT
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = pixels[x, y]
            if r > g + 6 and r > b + 6:
                if min(g, b) > 180:
                    pixels[x, y] = (255, 255, 255)
                else:
                    gray = min(g, b)
                    pixels[x, y] = (gray, gray, gray)


def insert_rgb_patch(doc: pymupdf.Document, page: pymupdf.Page,
                     image: Image.Image, box: tuple[int, int, int, int]) -> int:
    """Insert a lossless DeviceRGB image patch at exact source-pixel bounds."""
    xref = doc.get_new_xref()
    doc.update_object(
        xref,
        f"<< /Type /XObject /Subtype /Image /Width {image.width} "
        f"/Height {image.height} /BitsPerComponent 8 "
        f"/ColorSpace /DeviceRGB /Filter /FlateDecode >>",
    )
    # Let MuPDF apply Flate compression exactly once.
    doc.update_stream(xref, image.tobytes(), new=1, compress=1)
    rect = pymupdf.Rect(*(v * PX_TO_PT for v in box))
    page.insert_image(rect, xref=xref, overlay=True, keep_proportion=False)
    return xref


def update_rates(base: Image.Image) -> list[tuple[int, int, int, int]]:
    """Replace only the digits that change in rows 1-9; return edited boxes."""
    glyphs = {ch: base.crop(box) for ch, box in GLYPH_BOX.items()}
    edits: list[tuple[int, int, int, int]] = []

    def replace_digit(row: int, char: str, paste_x: int,
                      erase_box: tuple[int, int, int, int]) -> None:
        top = ROW_TOP[row]
        base.paste((255, 255, 255), erase_box)
        base.paste(glyphs[char], (paste_x, top))
        edits.append(erase_box)

    # Row 1: 1,900 -> 2,000. Replace the leading 1 and the hundreds 9.
    replace_digit(1, "2", 228, (222, 512, 266, 575))
    replace_digit(1, "0", 288, (282, 512, 325, 575))
    # Rows 2-3: 2,000 -> 2,200.
    for row in (2, 3):
        top = ROW_TOP[row]
        replace_digit(row, "2", 287, (282, top - 7, 325, top + 56))
    # Rows 4-5: 2,200 -> 2,400.
    for row in (4, 5):
        top = ROW_TOP[row]
        replace_digit(row, "4", 286, (281, top - 7, 326, top + 56))
    # Row 6: 2,100 -> 2,300.
    replace_digit(6, "3", 288, (282, 1204, 325, 1267))
    # Rows 7-8: 2,300 -> 2,500.
    for row in (7, 8):
        top = ROW_TOP[row]
        replace_digit(row, "5", 288, (282, top - 7, 325, top + 56))
    # Row 9: 2,600 -> 2,800. This row is shifted slightly right in the source.
    replace_digit(9, "8", 297, (290, 1620, 336, 1683))
    return edits


def main() -> None:
    doc = pymupdf.open(SOURCE)
    assert len(doc) == 1, "Expected the supplied single-page rate list"
    page = doc[0]
    original_images = page.get_images(full=True)
    assert len(original_images) == 3, "Unexpected PDF layer structure"

    # Render with MuPDF itself so patch lettering matches the PDF renderer.
    pix = page.get_pixmap(matrix=pymupdf.Matrix(300 / 72, 300 / 72), alpha=False)
    assert (pix.width, pix.height) == (2550, 4200), "Unexpected source resolution"
    base = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    logo = clean_logo_background(Image.open(LOGO))

    # Keep the original Urdu heading and tagline, reflowed around the new mark.
    title = base.crop((1030, 15, 1540, 208))
    tagline = base.crop((1075, 330, 1465, 440))
    base.paste((255, 255, 255), HEADER_EDIT)
    paste_centered(base, fit_width(title, 360), 6)
    paste_centered(base, fit_width(logo, 390), 145)
    paste_centered(base, fit_width(tagline, 280), 374)

    # Replace the old pink watermark with a very light version of the new logo.
    remove_pink_watermark(base)
    wm = fit_width(logo, 1500)
    faint = Image.blend(Image.new("RGB", wm.size, "white"), wm, 0.085)
    left = PAGE_CENTER_X - wm.width // 2
    top = 1950 - wm.height // 2
    region_box = (left, top, left + wm.width, top + wm.height)
    region = base.crop(region_box)
    base.paste(ImageChops.multiply(region, faint), region_box)

    # Update the requested rates using glyphs from the original document.
    rate_edits = update_rates(base)

    # Overlay only edited rectangles; original image streams stay intact.
    insert_rgb_patch(doc, page, base.crop(HEADER_EDIT), HEADER_EDIT)
    insert_rgb_patch(doc, page, base.crop(WATERMARK_EDIT), WATERMARK_EDIT)
    for box in rate_edits:
        insert_rgb_patch(doc, page, base.crop(box), box)

    metadata = dict(doc.metadata)
    metadata["title"] = "D&D Dress & Design — Rate List"
    metadata["subject"] = "Updated D&D logo and rates 1-9; other rates and Urdu text preserved"
    doc.set_metadata(metadata)
    doc.save(OUTPUT, garbage=4, deflate=True)
    doc.close()

    # Render previews from the actual PDFs, not from the editing canvas.
    with pymupdf.open(SOURCE) as original, pymupdf.open(OUTPUT) as updated:
        assert len(updated) == len(original)
        assert updated[0].rect == original[0].rect
        before = original[0].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        after = updated[0].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        before.save(ASSETS / "original-preview.png")
        after.save(ASSETS / "updated-preview.png")

        # Every original image stream must remain byte-for-byte identical.
        for img in original_images:
            name = img[7]
            old_xref = img[0]
            new_xref = next(i[0] for i in updated[0].get_images(full=True) if i[7] == name)
            assert original.extract_image(old_xref)["image"] == updated.extract_image(new_xref)["image"]

    # Verify that no rendered pixel outside the edited patches changed.
    before_im = Image.open(ASSETS / "original-preview.png").convert("RGB")
    after_im = Image.open(ASSETS / "updated-preview.png").convert("RGB")
    diff = ImageChops.difference(before_im, after_im)
    allowed = Image.new("L", diff.size, 0)
    draw = ImageDraw.Draw(allowed)
    scale = 2 * 612 / 2550
    for box in [HEADER_EDIT, WATERMARK_EDIT, *rate_edits]:
        x0, y0, x1, y1 = (v * scale for v in box)
        draw.rectangle((int(x0) - 2, int(y0) - 2, int(x1) + 2, int(y1) + 2), fill=255)
    outside = ImageChops.multiply(diff.convert("L"), ImageChops.invert(allowed))
    assert outside.getbbox() is None, "Pixels changed outside the edited patches"

    report = {
        "pages": 1,
        "page_size_pt": [612, 1008],
        "header_and_watermark": "replaced with supplied D&D logo",
        "updated_rates": NEW_RATES,
        "urdu_heading_and_tagline": "preserved",
        "rates_10_to_24": "unchanged",
        "original_pdf_image_streams": "byte-identical",
        "render_outside_edited_patches": "pixel-identical",
        "output_bytes": OUTPUT.stat().st_size,
    }
    (ASSETS / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
