"""Binary package integrity is checked before inspection or XML export."""

import io
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from docx_ray.models import DocxError
from docx_ray.service import inspect_docx, xml_bundle

SAMPLE = (Path(__file__).resolve().parents[1] / "public/sample.docx").read_bytes()


def binary_fixture(*, corrupt=False, null_name=False, size=32):
    output = io.BytesIO()
    name = "word/media/nullXtail.bin"
    with zipfile.ZipFile(io.BytesIO(SAMPLE)) as source, zipfile.ZipFile(output, "w") as target:
        for entry in source.infolist():
            target.writestr(entry, source.read(entry))
        target.writestr(name, bytes(range(32)) * (size // 32), compress_type=zipfile.ZIP_STORED)
    data = bytearray(output.getvalue())
    if corrupt:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entry = archive.getinfo(name)
            offset = entry.header_offset
        name_size, extra_size = struct.unpack_from("<HH", data, offset + 26)
        data[offset + 30 + name_size + extra_size] ^= 1
    if null_name:
        data = data.replace(name.encode(), name.replace("X", "\x00").encode())
    return bytes(data)


class BinaryIntegrityTests(unittest.TestCase):
    def test_corrupt_binary_entry_rejected(self):
        with self.assertRaisesRegex(DocxError, "corrupt"):
            inspect_docx(binary_fixture(corrupt=True))

    def test_null_in_original_zip_name_rejected(self):
        with self.assertRaisesRegex(DocxError, "Unsafe archive path"):
            inspect_docx(binary_fixture(null_name=True))

    def test_cli_rejects_corrupt_binary_before_creating_export(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "corrupt.docx"
            output = Path(directory) / "xml.zip"
            source.write_bytes(binary_fixture(corrupt=True))
            result = subprocess.run(
                [sys.executable, "-m", "docx_ray.cli", str(source), "--json", "--output", str(output)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("corrupt", result.stderr)
            self.assertEqual(result.stdout, "")
            self.assertFalse(output.exists())

    def test_large_valid_binary_survives_inspection_and_xml_export(self):
        data = binary_fixture(size=2_200_000)
        result = inspect_docx(data)
        part = next(p for p in result["parts"] if p["path"].endswith("nullXtail.bin"))
        self.assertEqual(part["kind"], "binary")
        self.assertEqual(part["bytes"], 2_200_000)
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(io.BytesIO(xml_bundle(data))) as exported:
            for part in result["parts"]:
                if part["kind"] == "xml":
                    self.assertEqual(source.read(part["path"]), exported.read(part["path"]))
            self.assertNotIn("word/media/nullXtail.bin", exported.namelist())
