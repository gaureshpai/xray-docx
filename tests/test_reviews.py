"""Review metadata and tracked-change markup remain available in raw XML."""

import io
import unittest
import zipfile
from pathlib import Path

from xray_docx.service import inspect_docx, xml_bundle

FIXTURE = (Path(__file__).parent / "reviewed.docx").read_bytes()


class ReviewMarkupTests(unittest.TestCase):
    def test_comments_and_anchors_visible(self):
        result = inspect_docx(FIXTURE, "reviewed.docx")
        parts = {part["path"]: part for part in result["parts"]}
        self.assertIn("Check this wording.", parts["word/comments.xml"]["xml"])
        raw = parts[result["mainPart"]]["xml"]
        for tag in ["commentRangeStart", "commentRangeEnd", "commentReference"]:
            self.assertIn(f"<w:{tag}", raw)
        self.assertTrue(any(rel["type"] == "comments" and rel["exists"] for rel in result["relationships"]))

    def test_tracked_changes_raw_and_preview_contract(self):
        result = inspect_docx(FIXTURE, "reviewed.docx")
        raw = next(part["xml"] for part in result["parts"] if part["path"] == result["mainPart"])
        for tag in ["ins", "del", "moveFrom", "moveTo", "delText"]:
            self.assertIn(f"<w:{tag}", raw)
        self.assertIn("Deleted words", raw)
        preview = "\n".join(paragraph["text"] for paragraph in result["paragraphs"])
        self.assertIn("Inserted words", preview)
        self.assertNotIn("Deleted words", preview)

    def test_review_xml_export_preserves_every_original_xml_byte(self):
        with (
            zipfile.ZipFile(io.BytesIO(FIXTURE)) as source,
            zipfile.ZipFile(io.BytesIO(xml_bundle(FIXTURE, "reviewed.docx"))) as exported,
        ):
            xml_paths = {name for name in source.namelist() if name.endswith((".xml", ".rels"))}
            self.assertEqual(xml_paths, set(exported.namelist()))
            for path in xml_paths:
                self.assertEqual(source.read(path), exported.read(path), path)


class PackageParityTests(unittest.TestCase):
    def changed(self, path, update):
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(FIXTURE)) as source, zipfile.ZipFile(output, "w") as target:
            for name in source.namelist():
                raw = source.read(name)
                target.writestr(name, update(raw.decode()).encode() if name == path else raw)
        return output.getvalue()

    def test_forged_main_relationship_rejected(self):
        from xray_docx.models import DocxError

        data = self.changed(
            "_rels/.rels",
            lambda xml: xml.replace(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
                "urn:forged/officeDocument",
            ),
        )
        with self.assertRaises(DocxError):
            inspect_docx(data)

    def test_foreign_content_override_rejected(self):
        from xray_docx.models import DocxError

        data = self.changed(
            "[Content_Types].xml",
            lambda xml: xml.replace(
                '<Override PartName="/word/document.xml"', '<Override xmlns="urn:forged" PartName="/word/document.xml"'
            ),
        )
        with self.assertRaises(DocxError):
            inspect_docx(data)

    def test_multiple_main_relationships_rejected(self):
        from xray_docx.models import DocxError

        data = self.changed(
            "_rels/.rels",
            lambda xml: xml.replace(
                "</Relationships>",
                '<Relationship Id="extra" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
            ),
        )
        with self.assertRaisesRegex(DocxError, "Multiple main"):
            inspect_docx(data)
