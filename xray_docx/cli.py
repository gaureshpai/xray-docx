"""Offline command line interface."""

import argparse
import json
import sys
from pathlib import Path
from xml.dom import minidom

from .models import CLI_LIMITS, DocxError
from .service import inspect_docx, xml_bundle


def formatted_xml(source):
    document = minidom.parseString(source)

    def remove_formatting_whitespace(node, preserve=False):
        preserve = preserve or (
            node.nodeType == node.ELEMENT_NODE
            and node.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space") == "preserve"
        )
        children = list(node.childNodes)
        has_text = any(
            child.nodeType in (child.TEXT_NODE, child.CDATA_SECTION_NODE) and child.data.strip() for child in children
        )
        if not preserve and not has_text:
            for child in children:
                if child.nodeType == child.TEXT_NODE and not child.data.strip():
                    node.removeChild(child)
        for child in node.childNodes:
            if child.nodeType == child.ELEMENT_NODE:
                remove_formatting_whitespace(child, preserve)

    remove_formatting_whitespace(document.documentElement)
    return document.toprettyxml(indent="  ")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Inspect DOCX XML without uploading your document.")
    parser.add_argument("document", type=Path)
    parser.add_argument("--json", action="store_true", help="Print full inspection JSON")
    parser.add_argument("--part", help="Print formatted XML for an exact package path")
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
            print(formatted_xml(part["xml"]), end="")
        elif args.json:
            print(json.dumps(result, indent=2, ensure_ascii=True))
        else:
            print(f"Xray DOCX · {result['filename']}\nMain XML: {result['mainPart']}")
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
        print(f"Xray DOCX: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
