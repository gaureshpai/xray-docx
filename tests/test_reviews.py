"""Review metadata and tracked-change markup remain available in raw XML."""

import io
import unittest
import zipfile
from pathlib import Path

from docx_ray.service import inspect_docx, xml_bundle

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
