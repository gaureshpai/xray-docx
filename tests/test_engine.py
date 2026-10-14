import io
import json
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from dataclasses import replace
from pathlib import Path
from xml.etree import ElementTree as ET

from docx_ray.models import DEFAULT_LIMITS, DocxError
from docx_ray.service import inspect_docx, parse_xml, xml_bundle, xml_part

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = (ROOT / "public/sample.docx").read_bytes()


def altered(changes=None, remove=(), extra=()):
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(SAMPLE)) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            if item.filename not in remove:
                target.writestr(item, (changes or {}).get(item.filename, source.read(item)))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for name, data in extra:
                target.writestr(name, data)
    return out.getvalue()


class EngineTests(unittest.TestCase):
    def test_sample_summary(self):
        result = inspect_docx(SAMPLE)
        self.assertEqual(result["mainPart"], "word/document.xml")
        self.assertEqual(result["summary"]["tables"], 1)
        self.assertEqual(result["summary"]["paragraphs"], 9)
        self.assertTrue(any("ಕನ್ನಡ" in p["text"] for p in result["paragraphs"]))
        self.assertTrue(any(r["type"] == "header" and r["exists"] for r in result["relationships"]))

    def test_raw_xml_exact_decoded_source(self):
        result = inspect_docx(SAMPLE)
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            for part in result["parts"]:
                if part["kind"] == "xml":
                    self.assertEqual(part["xml"], archive.read(part["path"]).decode("utf-8-sig"))

    def test_export_bytes_and_paths_preserved(self):
        with (
            zipfile.ZipFile(io.BytesIO(SAMPLE)) as original,
            zipfile.ZipFile(io.BytesIO(xml_bundle(SAMPLE))) as exported,
        ):
            expected = [name for name in original.namelist() if name.endswith((".xml", ".rels"))]
            self.assertEqual(set(expected), set(exported.namelist()))
            for name in expected:
                self.assertEqual(original.read(name), exported.read(name))

    def test_paragraph_mapping(self):
        result = inspect_docx(SAMPLE)
        for paragraph in result["paragraphs"]:
            root = ET.fromstring(paragraph["xml"])
            text = "".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
            self.assertEqual(text, paragraph["text"])

    def test_public_upstream_document(self):
        result = inspect_docx((ROOT / "tests/upstream.docx").read_bytes(), "upstream.docx")
        self.assertGreater(result["summary"]["xmlParts"], 5)
        self.assertGreater(result["summary"]["paragraphs"], 0)

    def test_not_zip(self):
        with self.assertRaises(DocxError):
            inspect_docx(b"not a zip")

    def test_legacy_extension(self):
        for filename in ["file.doc", "file.docm", "file.zip"]:
            with self.subTest(filename=filename), self.assertRaises(DocxError):
                inspect_docx(SAMPLE, filename)

    def test_missing_required_parts(self):
        for name in ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]:
            with self.subTest(name=name), self.assertRaises(DocxError):
                inspect_docx(altered(remove=[name]))

    def test_malformed_xml(self):
        with self.assertRaises(DocxError):
            inspect_docx(altered({"word/document.xml": b"<w:document>"}))

    def test_entity_declarations_all_encodings(self):
        value = '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>'
        for encoding in ["utf-8", "utf-16", "utf-32", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"]:
            with self.subTest(encoding=encoding), self.assertRaises(DocxError):
                parse_xml(value.encode(encoding))

    def test_utf16_xml_decode(self):
        text, root = parse_xml('<?xml version="1.0" encoding="utf-16"?><root>café</root>'.encode("utf-16"))
        self.assertIn("café", text)
        self.assertEqual(root.text, "café")

    def test_unsafe_paths(self):
        for name in ["../escape.xml", "/absolute.xml", "word/../../escape.xml", "word\\escape.xml", "C:/evil.xml"]:
            with self.subTest(name=name), self.assertRaises(DocxError):
                data = altered(extra=[(name, b"<root/>")])
                if "\\" in name:
                    data = data.replace(name.replace("\\", "/").encode(), name.encode())
                inspect_docx(data)

    def test_duplicate_entries(self):
        with self.assertRaises(DocxError):
            inspect_docx(altered(extra=[("word/document.xml", b"<root/>")]))

    def test_symlink(self):
        link = zipfile.ZipInfo("link")
        link.create_system = 3
        link.external_attr = 0o120777 << 16
        with self.assertRaises(DocxError):
            inspect_docx(altered(extra=[(link, b"word/document.xml")]))

    def test_limits(self):
        for field, value in [
            ("input_bytes", 1),
            ("expanded_bytes", 1),
            ("entries", 1),
            ("xml_bytes", 1),
            ("response_bytes", 1),
        ]:
            with self.subTest(field=field), self.assertRaises(DocxError):
                inspect_docx(SAMPLE, limits=replace(DEFAULT_LIMITS, **{field: value}))

    def test_external_reference_not_fetched(self):
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            rels = archive.read("word/_rels/document.xml.rels").decode()
        rels = rels.replace(
            "</Relationships>",
            '<Relationship Id="rExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/secret" TargetMode="External"/></Relationships>',
        )
        result = inspect_docx(altered({"word/_rels/document.xml.rels": rels.encode()}))
        rel = next(r for r in result["relationships"] if r["id"] == "rExternal")
        self.assertTrue(rel["external"])
        self.assertIsNone(rel["resolved"])

    def test_custom_main_part_path(self):
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            types = archive.read("[Content_Types].xml").replace(b"/word/document.xml", b"/custom/document.xml")
            rels = archive.read("_rels/.rels").replace(b"word/document.xml", b"custom/document.xml")
            document = archive.read("word/document.xml")
        result = inspect_docx(
            altered(
                {"[Content_Types].xml": types, "_rels/.rels": rels},
                remove=["word/document.xml"],
                extra=[("custom/document.xml", document)],
            )
        )
        self.assertEqual(result["mainPart"], "custom/document.xml")

    def test_cli_json(self):
        run = subprocess.run(
            [sys.executable, "-m", "docx_ray", "public/sample.docx", "--json"], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertEqual(result["summary"]["tables"], 1)
        self.assertTrue(any("ಕನ್ನಡ" in paragraph["text"] for paragraph in result["paragraphs"]))

    def test_cli_export_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "xml.zip"
            command = [sys.executable, "-m", "docx_ray", "public/sample.docx", "--output", str(output)]
            run = subprocess.run(command, cwd=ROOT, capture_output=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            contents = output.read_bytes()
            self.assertEqual(subprocess.run(command, cwd=ROOT, capture_output=True).returncode, 2)
            self.assertEqual(output.read_bytes(), contents)

    def test_cli_missing_part(self):
        run = subprocess.run(
            [sys.executable, "-m", "docx_ray", "public/sample.docx", "--part", "missing.xml"],
            cwd=ROOT,
            capture_output=True,
        )
        self.assertEqual(run.returncode, 2)


class AdditionalEngineTests(unittest.TestCase):
    def test_original_single_part_bytes(self):
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            self.assertEqual(xml_part(SAMPLE, "word/document.xml"), archive.read("word/document.xml"))
        with self.assertRaises(DocxError):
            xml_part(SAMPLE, "../secret")

    def test_nesting_limit(self):
        with self.assertRaises(DocxError):
            parse_xml(("<a>" * 102 + "</a>" * 102).encode())

    def test_absolute_relationship_target(self):
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            rels = archive.read("word/_rels/document.xml.rels").decode()
        rels = rels.replace('Target="styles.xml"', 'Target="/word/styles.xml"')
        result = inspect_docx(altered({"word/_rels/document.xml.rels": rels.encode()}))
        rel = next(r for r in result["relationships"] if r["type"] == "styles")
        self.assertEqual(rel["resolved"], "word/styles.xml")
        self.assertTrue(rel["exists"])

    def test_macro_content_type_rejected(self):
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            types = archive.read("[Content_Types].xml").replace(
                b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
                b"application/vnd.ms-word.document.macroEnabled.main+xml",
            )
        with self.assertRaises(DocxError):
            inspect_docx(altered({"[Content_Types].xml": types}))
