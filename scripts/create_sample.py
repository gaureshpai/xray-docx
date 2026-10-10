"""Reproducible, synthetic test document. Requires python-docx only for generation."""

from pathlib import Path

from docx import Document

root = Path(__file__).resolve().parents[1]
doc = Document()
doc.add_heading("A look beneath the page", 0)
doc.add_paragraph("Hello from DOCX Ray. This sentence lives inside a w:t text node.")
p = doc.add_paragraph("A paragraph can contain ")
p.add_run("bold text").bold = True
p.add_run(", italic text").italic = True
p.add_run(", and multiple runs.")
doc.add_heading("Structured content", 1)
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = "Part"
table.cell(0, 1).text = "Purpose"
table.cell(1, 0).text = "word/document.xml"
table.cell(1, 1).text = "Main document body"
doc.sections[0].header.paragraphs[0].text = "DOCX Ray sample header"
doc.sections[0].footer.paragraphs[0].text = "Made for inspection, not mystery."
doc.add_paragraph("Unicode works too: Bengaluru · café · ಕನ್ನಡ · 日本語")
doc.save(root / "public/sample.docx")
print(root / "public/sample.docx")
