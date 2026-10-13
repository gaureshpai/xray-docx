"""Offline command line interface."""

import argparse
import json
import sys
from pathlib import Path

from .models import CLI_LIMITS, DocxError
from .service import inspect_docx, xml_bundle


def main(argv=None):
    parser = argparse.ArgumentParser(description="Inspect DOCX XML without uploading your document.")
    parser.add_argument("document", type=Path)
    parser.add_argument("--json", action="store_true", help="Print full inspection JSON")
    parser.add_argument("--part", help="Print decoded source XML for an exact package path")
    parser.add_argument("--output", type=Path, help="Save byte-preserving XML parts as a ZIP")
    args = parser.parse_args(argv)
    try:
        with args.document.open("rb") as source:
            data = source.read(CLI_LIMITS.input_bytes + 1)
        result = inspect_docx(data, args.document.name, CLI_LIMITS)
        if args.part:
            part = next((p for p in result["parts"] if p["path"] == args.part and p["kind"] == "xml"), None)
            if part is None:
                raise DocxError("XML part not found.")
            print(part["xml"])
        elif args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(f"DOCX Ray · {result['filename']}\nMain XML: {result['mainPart']}")
            for key, value in result["summary"].items():
                print(f"{key}: {value}")
            print(f"comments: {len(result['comments'])}\nrevisions: {len(result['revisions'])}")
            for part in result["parts"]:
                print(f"{part['kind']:6} {part['bytes']:8,} B  {part['path']}")
        if args.output:
            # Exclusive creation protects an existing output or source document.
            with args.output.open("xb") as target:
                target.write(xml_bundle(data, args.document.name, CLI_LIMITS))
            print(f"Saved {args.output}", file=sys.stderr)
        return 0
    except (DocxError, OSError) as exc:
        print(f"DOCX Ray: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
