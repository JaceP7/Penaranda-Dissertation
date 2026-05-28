"""Extract text from dissertation PDFs for audit."""
import pdfplumber
from pathlib import Path

PDF_1 = r"C:\Users\Jace\Desktop\College Files\diko\Revised Version - Penaranda, Jester - DIT Dissertation - Ch 1-2.pdf"
PDF_2 = r"C:\Users\Jace\Desktop\College Files\diko\Instruments to be used.pdf"

OUT_DIR = Path(r"C:\Users\Jace\Desktop\College Files\diko\dissertation")

def extract(pdf_path, out_name):
    print(f"\n=== Extracting: {Path(pdf_path).name} ===")
    out_file = OUT_DIR / out_name
    with pdfplumber.open(pdf_path) as pdf:
        print(f"Pages: {len(pdf.pages)}")
        all_text = []
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            all_text.append(f"\n\n===== PAGE {i+1} =====\n\n{text}")
        full = "\n".join(all_text)
        out_file.write_text(full, encoding="utf-8")
        print(f"Saved: {out_file}")
        print(f"Char count: {len(full):,}")
        return full

t1 = extract(PDF_1, "_dissertation_ch1_2.txt")
t2 = extract(PDF_2, "_instruments.txt")
print("\n\n=== DONE ===")
