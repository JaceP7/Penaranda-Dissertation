"""
Generate the physical fieldwork kit for the Calamba City Hall survey:

  1. fieldwork_kit/qr_test_codes.pdf     — printable QR anchor codes to test scanning on-site
  2. fieldwork_kit/data_capture_form.pdf — printable per-office data form (print ~8 pages)
  3. fieldwork_kit/field_cheat_sheet.pdf — one-page day-of reference

QR format matches the scanner: GRID:<floor>:<row>,<col>  (floor is 0-indexed internal:
  0=Lower Ground, 1=Ground, 2=Second, 3=Third)
"""

import qrcode
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas

OUT_DIR = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation\fieldwork_kit")
OUT_DIR.mkdir(parents=True, exist_ok=True)
QR_TMP = OUT_DIR / "_qr_tmp"
QR_TMP.mkdir(exist_ok=True)

PAGE_W, PAGE_H = A4

DARK = colors.HexColor("#1E293B")
GREY = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F1F5F9")
GREEN = colors.HexColor("#16A34A")
AMBER = colors.HexColor("#D97706")

# ── QR anchor positions (internal 0-indexed floors) ──────────────────────────
# These are SUGGESTED test positions from the 75x75 grid. Confirm/adjust on-site.
FLOOR_NAMES = {0: "Lower Ground", 1: "Ground", 2: "Second", 3: "Third"}

QR_ANCHORS = [
    # (floor, row, col, human label)
    (1, 70, 37, "Ground - MAIN ENTRANCE"),
    (1, 37, 37, "Ground - Atrium Center"),
    (1, 15, 37, "Ground - North Stair"),
    (1, 57, 37, "Ground - South Stair"),
    (0, 37, 37, "Lower Ground - Atrium Center"),
    (0, 15, 37, "Lower Ground - North Stair"),
    (2, 37, 37, "Second - Atrium Center"),
    (2, 15, 37, "Second - North Stair"),
    (3, 37, 37, "Third - Atrium Center"),
    (3, 15, 37, "Third - North Stair"),
]


def make_qr_png(payload: str, path: Path):
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img.save(path)


# ─────────────────────────────────────────────────────────────────────────────
# 1. QR TEST CODES PDF
# ─────────────────────────────────────────────────────────────────────────────

def build_qr_pdf():
    out = OUT_DIR / "qr_test_codes.pdf"
    c = pdfcanvas.Canvas(str(out), pagesize=A4)

    # Header
    c.setFillColor(DARK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(20 * mm, PAGE_H - 22 * mm, "QR Anchor Test Codes")
    c.setFillColor(GREY)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, PAGE_H - 28 * mm,
                 "Print this page. Cut out codes. Tape to walls and test scanning in Nav Mode.")
    c.drawString(20 * mm, PAGE_H - 33 * mm,
                 "Format: GRID:floor:row,col  (floor 0=Lower Ground, 1=Ground, 2=Second, 3=Third)")

    # Grid layout: 2 columns x 5 rows
    cols, rows = 2, 5
    cell_w = (PAGE_W - 40 * mm) / cols
    cell_h = (PAGE_H - 50 * mm) / rows
    qr_size = 38 * mm

    for i, (floor, row, col, label) in enumerate(QR_ANCHORS):
        cidx = i % cols
        ridx = i // cols
        x = 20 * mm + cidx * cell_w
        y = PAGE_H - 45 * mm - (ridx + 1) * cell_h

        payload = f"GRID:{floor}:{row},{col}"
        qr_path = QR_TMP / f"qr_{floor}_{row}_{col}.png"
        make_qr_png(payload, qr_path)

        # Draw QR
        c.drawImage(ImageReader(str(qr_path)),
                    x + 6 * mm, y + cell_h - qr_size - 8 * mm,
                    qr_size, qr_size)

        # Label
        c.setFillColor(DARK)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + qr_size + 12 * mm, y + cell_h - 16 * mm, label)
        c.setFillColor(GREY)
        c.setFont("Courier", 9)
        c.drawString(x + qr_size + 12 * mm, y + cell_h - 22 * mm, payload)
        c.setFont("Helvetica", 8)
        c.drawString(x + qr_size + 12 * mm, y + cell_h - 30 * mm,
                     f"Floor {floor} ({FLOOR_NAMES[floor]})")
        c.drawString(x + qr_size + 12 * mm, y + cell_h - 36 * mm,
                     f"Cell: row {row}, col {col}")

        # Cut border
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.setDash(2, 2)
        c.rect(x + 2 * mm, y + 2 * mm, cell_w - 4 * mm, cell_h - 4 * mm)
        c.setDash()

    c.save()
    print(f"  {out}")


# ─────────────────────────────────────────────────────────────────────────────
# 2. DATA CAPTURE FORM PDF
# ─────────────────────────────────────────────────────────────────────────────

def build_data_form_pdf():
    out = OUT_DIR / "data_capture_form.pdf"
    c = pdfcanvas.Canvas(str(out), pagesize=A4)

    BLOCKS_PER_PAGE = 3
    NUM_PAGES = 9   # 27 office slots (21 depts + buffer)

    def draw_block(x, y, w, h, n):
        # Outer box
        c.setStrokeColor(DARK)
        c.setLineWidth(1)
        c.rect(x, y, w, h)

        # Block number badge
        c.setFillColor(DARK)
        c.rect(x, y + h - 8 * mm, 12 * mm, 8 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 3 * mm, y + h - 6 * mm, f"#{n}")

        pad = 4 * mm
        line_y = y + h - 14 * mm
        lh = 7 * mm

        def field(label, ix=0, width_frac=1.0):
            fx = x + pad + ix
            c.setFillColor(GREY)
            c.setFont("Helvetica", 7.5)
            c.drawString(fx, line_y + 0.5 * mm, label)
            c.setStrokeColor(colors.HexColor("#94A3B8"))
            c.setLineWidth(0.4)
            underline_start = fx + c.stringWidth(label, "Helvetica", 7.5) + 2 * mm
            underline_end = x + w * width_frac - pad
            c.line(underline_start, line_y, underline_end, line_y)

        # Row 1: Official dept name (full width)
        field("Official office name:", 0, 1.0)
        line_y -= lh
        # Row 2: Aliases
        field("Citizens call it (aliases):", 0, 1.0)
        line_y -= lh
        # Row 3: Floor / Row / Col
        field("Floor (0-3):", 0, 0.30)
        field("Row (0-74):", w * 0.33, 0.62)
        field("Col (0-74):", w * 0.66, 0.97)
        line_y -= lh
        # Row 4: Door position / public
        field("Door wall (N/S/E/W):", 0, 0.55)
        field("Public? (Y/N):", w * 0.58, 0.97)
        line_y -= lh
        # Row 5: Office hours
        field("Office hours:", 0, 1.0)
        line_y -= lh
        # Row 6: Photo ref
        field("Photo filename:", 0, 1.0)
        line_y -= lh
        # Row 7: Notes
        field("Notes:", 0, 1.0)

    for page in range(NUM_PAGES):
        # Header
        c.setFillColor(DARK)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(20 * mm, PAGE_H - 16 * mm, "Field Data Capture Form")
        c.setFillColor(GREY)
        c.setFont("Helvetica", 8)
        c.drawString(20 * mm, PAGE_H - 21 * mm,
                     "One block per office. Fill in by hand at City Hall. "
                     f"Page {page+1}/{NUM_PAGES}")

        block_w = PAGE_W - 40 * mm
        block_h = (PAGE_H - 35 * mm) / BLOCKS_PER_PAGE - 4 * mm
        for b in range(BLOCKS_PER_PAGE):
            n = page * BLOCKS_PER_PAGE + b + 1
            bx = 20 * mm
            by = PAGE_H - 28 * mm - (b + 1) * (block_h + 4 * mm)
            draw_block(bx, by, block_w, block_h, n)

        c.showPage()

    c.save()
    print(f"  {out}")


# ─────────────────────────────────────────────────────────────────────────────
# 3. FIELD CHEAT SHEET PDF (one page)
# ─────────────────────────────────────────────────────────────────────────────

def build_cheat_sheet_pdf():
    out = OUT_DIR / "field_cheat_sheet.pdf"
    c = pdfcanvas.Canvas(str(out), pagesize=A4)

    y = PAGE_H - 18 * mm
    c.setFillColor(DARK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(15 * mm, y, "FIELD DAY CHEAT SHEET")
    y -= 6 * mm
    c.setFillColor(GREY)
    c.setFont("Helvetica", 9)
    c.drawString(15 * mm, y, "Calamba City Hall - Geo-Agentic RAG Wayfinding Survey")
    y -= 10 * mm

    def section(title):
        nonlocal y
        c.setFillColor(DARK)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(15 * mm, y, title)
        y -= 6 * mm

    def bullet(text, indent=0, color=None):
        nonlocal y
        c.setFillColor(color or colors.HexColor("#334155"))
        c.setFont("Helvetica", 9.5)
        c.drawString((18 + indent) * mm, y, f"- {text}")
        y -= 5.2 * mm

    section("BEFORE YOU LEAVE")
    bullet("Phone: 100% charged, sleep DISABLED, brightness MAX")
    bullet("Camera + motion permissions allowed for the app")
    bullet("Power bank, tape measure, painter's tape, 2 pens (blue + red)")
    bullet("Printed: floor grid maps, QR test codes, data forms x8, this sheet")
    bullet("Permission letter from adviser")
    y -= 3 * mm

    section("ORDER OF FLOORS (do Ground first)")
    bullet("1. GROUND (Floor 1) - 8 offices, has main entrance, most important", color=GREEN)
    bullet("2. LOWER GROUND (Floor 0) - 12 offices")
    bullet("3. SECOND (Floor 2) - 12 offices")
    bullet("4. THIRD (Floor 3) - executive, do last")
    y -= 3 * mm

    section("AT EACH OFFICE (repeat)")
    bullet("1. Read the door sign - note OFFICIAL name")
    bullet("2. PHOTO the signage (note filename on form)")
    bullet("3. Mark room position on printed grid map (red pen)")
    bullet("4. Fill one data-form block: floor, row, col, door wall, hours")
    bullet("5. Check off the department on your list")
    y -= 3 * mm

    section("QR ANCHORS (4-6 per floor)")
    bullet("Pick: entrance, top of each stair, near popular offices")
    bullet("Tape a blue marker, photo the spot, note the grid cell")
    bullet("Test-scan a printed QR there to confirm it reads", color=AMBER)
    y -= 3 * mm

    section("CALIBRATION (once)")
    bullet("Measure ONE straight corridor in metres")
    bullet("Count grid cells it spans -> metresPerCell = metres / cells")
    y -= 3 * mm

    section("ASK STAFF (priority questions)")
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica", 8.5)
    for q in [
        "1. CSSYDO = City Social Services Dept? (same or separate)",
        "2. Prosecutor = City Legal Services Office? (same or separate)",
        "3. Saan ang OSCA, CDRRMD, at City College? (floor + building)",
        "4. Population Office - main counter sa Floor 2 o Floor 3?",
        "5. Ano ibig sabihin ng numero sa tabi ng office? (tao/upuan?)",
        "6. May public Wi-Fi ba sa loob? (para sa SUS evaluation)",
    ]:
        c.drawString(18 * mm, y, q)
        y -= 4.6 * mm
    y -= 2 * mm

    section("IF SOMETHING GOES WRONG")
    bullet("Locked office -> skip, note it, come back")
    bullet("Name mismatch -> use the DOOR sign as canonical")
    bullet("QR on glass -> pick a solid-wall spot instead")
    bullet("Compass off -> tap 'Recal' in Nav Mode")

    # Footer
    c.setFillColor(GREY)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(15 * mm, 12 * mm,
                 "Full plan: FIELDWORK_A2_PLAN.md  |  Test plan: USABILITY_TEST_PLAN.md")

    c.save()
    print(f"  {out}")


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Generating fieldwork kit:")
    build_qr_pdf()
    build_data_form_pdf()
    build_cheat_sheet_pdf()
    # Clean up temp QR PNGs
    for f in QR_TMP.glob("*.png"):
        f.unlink()
    QR_TMP.rmdir()
    print(f"\nAll saved to: {OUT_DIR}")
