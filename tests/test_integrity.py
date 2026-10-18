"""Binary package integrity is checked before inspection or XML export."""

import hashlib
import io
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

from xray_docx.models import DocxError
from xray_docx.service import inspect_docx, xml_bundle

SAMPLE = (Path(__file__).resolve().parents[1] / "public/sample.docx").read_bytes()


def binary_fixture(
    *,
    corrupt=False,
    null_name=False,
    size=32,
    deflated=False,
    under_report=False,
    invalid_local_utf8=False,
    truncated=False,
    random_data=False,
):
    output = io.BytesIO()
    name = "word/media/nullXtail.bin"
    with zipfile.ZipFile(io.BytesIO(SAMPLE)) as source, zipfile.ZipFile(output, "w") as target:
        for entry in source.infolist():
            target.writestr(entry, source.read(entry))
        payload = (
            hashlib.shake_256(b"Xray DOCX synthetic binary").digest(size)
            if random_data
            else bytes(range(32)) * (size // 32)
        )
        target.writestr(
            name,
            payload,
            compress_type=zipfile.ZIP_DEFLATED if deflated else zipfile.ZIP_STORED,
        )
    data = bytearray(output.getvalue())
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entry = archive.getinfo(name)
        offset = entry.header_offset
    if truncated:
        central = data.rfind(b"PK\x01\x02")
        struct.pack_into("<I", data, offset + 18, entry.compress_size - 1)
        struct.pack_into("<I", data, central + 20, entry.compress_size - 1)
    if under_report:
        central = data.rfind(b"PK\x01\x02")
        struct.pack_into("<I", data, offset + 14, zlib.crc32(b"\x00"))
        struct.pack_into("<I", data, offset + 22, 1)
        struct.pack_into("<I", data, central + 16, zlib.crc32(b"\x00"))
        struct.pack_into("<I", data, central + 24, 1)
    if invalid_local_utf8:
        struct.pack_into("<H", data, offset + 6, 0x800)
        data[offset + 30] = 255
    if corrupt:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entry = archive.getinfo(name)
            offset = entry.header_offset
        name_size, extra_size = struct.unpack_from("<HH", data, offset + 26)
        start = offset + 30 + name_size + extra_size
        if deflated:
            data[start] = 7  # Reserved DEFLATE block type.
        else:
            data[start] ^= 1
    if null_name:
        data = data.replace(name.encode(), name.replace("X", "\x00").encode())
    return bytes(data)


class BinaryIntegrityTests(unittest.TestCase):
    def test_truncated_deflate_stream_rejected(self):
        with self.assertRaisesRegex(DocxError, "corrupt"):
            inspect_docx(binary_fixture(deflated=True, truncated=True))

    def test_large_valid_deflate_stream_checks_input_and_output_boundaries(self):
        for random_data in (False, True):
            with self.subTest(random_data=random_data):
                result = inspect_docx(binary_fixture(size=2_200_000, deflated=True, random_data=random_data))
                self.assertTrue(any(p["bytes"] == 2_200_000 and p["kind"] == "binary" for p in result["parts"]))

    def test_deflate_output_beyond_declared_size_rejected(self):
        with self.assertRaisesRegex(DocxError, "size mismatch"):
            inspect_docx(binary_fixture(deflated=True, under_report=True))

    def test_stored_output_beyond_declared_size_rejected(self):
        with self.assertRaisesRegex(DocxError, "size mismatch"):
            inspect_docx(binary_fixture(under_report=True))

    def test_invalid_local_utf8_returns_document_error(self):
        with self.assertRaisesRegex(DocxError, "corrupt"):
            inspect_docx(binary_fixture(invalid_local_utf8=True))

    def test_cli_rejects_under_reported_sizes_and_invalid_local_utf8(self):
        for options in ({"deflated": True, "under_report": True}, {"invalid_local_utf8": True}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "invalid.docx"
                source.write_bytes(binary_fixture(**options))
                result = subprocess.run(
                    [sys.executable, "-m", "xray_docx.cli", str(source)], capture_output=True, text=True
                )
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_malformed_deflate_binary_returns_document_error(self):
        with self.assertRaisesRegex(DocxError, "corrupt"):
            inspect_docx(binary_fixture(corrupt=True, deflated=True))

    def test_cli_deflate_error_has_no_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "deflate.docx"
            source.write_bytes(binary_fixture(corrupt=True, deflated=True))
            result = subprocess.run(
                [sys.executable, "-m", "xray_docx.cli", str(source)], capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("corrupt", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.stdout, "")

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
                [sys.executable, "-m", "xray_docx.cli", str(source), "--json", "--output", str(output)],
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
