"""Read-only OOXML package inspection. Never extract untrusted ZIP paths to disk."""

import hashlib
import io
import json
import posixpath
import stat
import zipfile
import zlib
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from .models import DEFAULT_LIMITS, DocxError

WORD_NAMESPACES = {
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
}
REL_NAMESPACES = {
    "http://schemas.openxmlformats.org/package/2006/relationships",
    "http://purl.oclc.org/ooxml/package/relationships",
}
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
DOC_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
}
OFFICE_DOCUMENT = {
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
}
REVISION_TYPES = {
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "rPrChange",
    "pPrChange",
    "tblPrChange",
    "tblGridChange",
    "trPrChange",
    "tcPrChange",
    "sectPrChange",
    "numberingChange",
    "cellIns",
    "cellDel",
    "cellMerge",
    "customXmlInsRangeStart",
    "customXmlDelRangeStart",
    "customXmlMoveFromRangeStart",
    "customXmlMoveToRangeStart",
}


def media_type(value):
    return (value or "").split(";", 1)[0].strip().lower()


def word_name(node):
    namespace, _, name = node.tag.removeprefix("{").partition("}")
    return name if namespace in WORD_NAMESPACES else None


def text_projection(root, *, removed=False, nested_paragraphs=True):
    chunks, stack = [], [root]
    paragraphs = 0
    while stack:
        node = stack.pop()
        name = word_name(node)
        if not removed and name in {"del", "moveFrom"}:
            continue
        if not nested_paragraphs and node is not root and name == "p":
            continue
        if nested_paragraphs and name == "p":
            if paragraphs:
                chunks.append("\n")
            paragraphs += 1
        if name == "t" or (removed and name == "delText"):
            chunks.append("".join(node.itertext()))
            continue
        if name == "tab":
            chunks.append("\t")
        if name in {"br", "cr"}:
            chunks.append("\n")
        if name == "noBreakHyphen":
            chunks.append("\u2011")
        if name == "softHyphen":
            chunks.append("\u00ad")
        stack.extend(reversed(node))
    return "".join(chunks)


def parse_xml(raw):
    # Decode before checking declarations, including UTF-16/32 input.
    try:
        if raw.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
            text = raw.decode("utf-32")
        elif raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            text = raw.decode("utf-16")
        else:
            text = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise DocxError("XML must use UTF-8 or BOM-marked UTF-16/32.") from exc
    if "\x00" in text:
        raise DocxError("XML contains null bytes or an unsupported encoding.")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise DocxError("DTD and entity declarations are not accepted.")
    try:
        root = ET.fromstring(text)
        stack = [(root, 0)]
        while stack:
            node, depth = stack.pop()
            if depth > 100:
                raise DocxError("XML nesting exceeds the safety limit.")
            stack.extend((child, depth + 1) for child in node)
        return text, root
    except ET.ParseError as exc:
        raise DocxError(f"Malformed XML: {exc}") from exc


def safe_path(name):
    path = PurePosixPath(name)
    if (
        not name
        or "\\" in name
        or "\x00" in name
        or ":" in name
        or name.startswith("/")
        or any(x in ("", ".", "..") for x in name.rstrip("/").split("/"))
    ):
        raise DocxError("Unsafe archive path.")
    return path


def inspect_docx(data, filename="document.docx", limits=DEFAULT_LIMITS):
    if not data or len(data) > limits.input_bytes:
        raise DocxError(f"Document must be between 1 and {limits.input_bytes:,} bytes.")
    if not filename.lower().endswith(".docx"):
        raise DocxError("Choose a .docx file. Legacy .doc and macro-enabled .docm are not supported.")
    try:
        return _inspect(data, filename, limits)
    except DocxError:
        raise
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError, OSError, zlib.error) as exc:
        raise DocxError("Invalid, encrypted, corrupt, or unsupported ZIP archive.") from exc


def _inspect(data, filename, limits):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > limits.entries:
            raise DocxError("Too many archive entries.")
        seen = set()
        expanded = 0
        for entry in entries:
            # ZipInfo.filename truncates at NUL; validate the original catalog name.
            safe_path(entry.orig_filename)
            safe_path(entry.filename)
            if entry.filename in seen:
                raise DocxError("Duplicate archive entry.")
            seen.add(entry.filename)
            if stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                raise DocxError("Symlinks and encrypted entries are not accepted.")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise DocxError("Unsupported ZIP compression method.")
            expanded += entry.file_size
            if expanded > limits.expanded_bytes:
                raise DocxError("Expanded archive exceeds the safety limit.")
        if "[Content_Types].xml" not in seen or "_rels/.rels" not in seen:
            raise DocxError("Not an OOXML package: content types and package relationships are required.")
        if archive.getinfo("[Content_Types].xml").file_size > limits.xml_bytes:
            raise DocxError("Combined XML exceeds the safety limit.")
        _, content_root = parse_xml(archive.read("[Content_Types].xml"))
        if content_root.tag != f"{{{CONTENT_NS}}}Types":
            raise DocxError("Invalid content types root.")
        overrides = {
            x.get("PartName", "").lstrip("/"): x.get("ContentType", "")
            for x in content_root
            if x.tag == f"{{{CONTENT_NS}}}Override"
        }
        defaults = {
            x.get("Extension", "").lower(): x.get("ContentType", "")
            for x in content_root
            if x.tag == f"{{{CONTENT_NS}}}Default"
        }
        parts, roots = [], {}
        xml_size = 0
        for entry in entries:
            if entry.is_dir():
                continue
            name = entry.filename
            content_type = overrides.get(
                name, defaults.get(name.rsplit(".", 1)[-1].lower(), "application/octet-stream")
            )
            normalized_type = media_type(content_type)
            is_xml = (
                name.lower().endswith((".xml", ".rels"))
                or normalized_type in {"application/xml", "text/xml"}
                or normalized_type.endswith("+xml")
            )
            part = {
                "path": name,
                "bytes": entry.file_size,
                "compressedBytes": entry.compress_size,
                "kind": "xml" if is_xml else "binary",
                "contentType": content_type,
            }
            if is_xml:
                xml_size += entry.file_size
                if xml_size > limits.xml_bytes:
                    raise DocxError("Combined XML exceeds the safety limit.")
                # Read at most declared size + 1 and validate CRC via ZipFile.
                with archive.open(entry) as source:
                    raw = source.read(min(entry.file_size + 1, limits.xml_bytes + 1))
                if len(raw) != entry.file_size:
                    raise DocxError("Archive entry size mismatch.")
                text, root = parse_xml(raw)
                roots[name] = root
                part.update(
                    xml=text,
                    sha256=hashlib.sha256(raw).hexdigest(),
                    encoding="utf-8"
                    if not raw.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff"))
                    else "unicode-bom",
                )
            else:
                # Consume binary parts too, so CRC/local-header errors cannot hide
                # behind XML-only inspection. Keep working memory bounded.
                remaining = entry.file_size
                with archive.open(entry) as source:
                    while True:
                        chunk = source.read(min(1_048_576, remaining + 1))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise DocxError("Archive entry size mismatch.")
                if remaining:
                    raise DocxError("Archive entry size mismatch.")
            parts.append(part)
        content_root = roots["[Content_Types].xml"]
        if content_root.tag != f"{{{CONTENT_NS}}}Types":
            raise DocxError("Invalid content types root.")
        relationships = []
        main_path = None
        for name, root in roots.items():
            if not name.endswith(".rels"):
                continue
            ns = root.tag.split("}")[0].lstrip("{")
            if ns not in REL_NAMESPACES or root.tag != f"{{{ns}}}Relationships":
                raise DocxError("Invalid relationships XML.")
            source = (
                "/"
                if name == "_rels/.rels"
                else str(PurePosixPath(name).parent.parent / PurePosixPath(name).name.removesuffix(".rels"))
            )
            for rel in root:
                if rel.tag != f"{{{ns}}}Relationship":
                    continue
                target = rel.get("Target", "")
                external = rel.get("TargetMode") == "External"
                resolved = (
                    None
                    if external
                    else posixpath.normpath(
                        posixpath.join(
                            "" if source == "/" or target.startswith("/") else posixpath.dirname(source),
                            target.lstrip("/"),
                        )
                    )
                )
                if not external:
                    safe_path(resolved)
                item = {
                    "source": source,
                    "id": rel.get("Id"),
                    "type": rel.get("Type", "").rsplit("/", 1)[-1],
                    "target": target,
                    "external": external,
                    "resolved": resolved,
                    "exists": None if external else resolved in seen,
                }
                relationships.append(item)
                if source == "/" and rel.get("Type") in OFFICE_DOCUMENT and not external:
                    if main_path:
                        raise DocxError("Multiple main document relationships.")
                    main_path = resolved
        if not main_path or main_path not in roots:
            raise DocxError("Package does not contain its main office document XML.")
        if media_type(overrides.get(main_path)) not in DOC_TYPES:
            raise DocxError("This package is not a macro-free DOCX document.")
        main = roots[main_path]
        ns = main.tag.split("}")[0].lstrip("{")
        if ns not in WORD_NAMESPACES or main.tag != f"{{{ns}}}document":
            raise DocxError("Invalid WordprocessingML document root.")

        def q(tag):
            return f"{{{ns}}}{tag}"

        paragraphs = []
        parents = {child: parent for parent in main.iter() for child in parent}
        for index, paragraph in enumerate(main.iter(q("p"))):
            ancestor = parents.get(paragraph)
            removed = False
            while ancestor is not None:
                if word_name(ancestor) in {"del", "moveFrom"}:
                    removed = True
                    break
                ancestor = parents.get(ancestor)
            text = "" if removed else text_projection(paragraph, nested_paragraphs=False)
            paragraphs.append({"index": index, "text": text, "xml": ET.tostring(paragraph, encoding="unicode")})
        comments, revisions = [], []
        comment_targets = {r["resolved"] for r in relationships if not r["external"] and r["type"] == "comments"}
        for part in parts:
            path = part["path"]
            if path not in roots or not (
                path == main_path
                or "wordprocessingml" in media_type(part["contentType"])
                or path in comment_targets
                or PurePosixPath(path).name.lower().startswith("comments")
            ):
                continue
            for node in roots[path].iter():
                kind = word_name(node)
                if kind != "comment" and kind not in REVISION_TYPES:
                    continue
                namespace = node.tag.split("}")[0] + "}"
                record = {
                    "part": path,
                    **{key: node.get(namespace + key, "") for key in ("id", "author", "date")},
                    "text": text_projection(node, removed=kind in {"del", "moveFrom"}),
                    "xml": ET.tostring(node, encoding="unicode"),
                }
                if kind == "comment":
                    comments.append(record)
                else:
                    revisions.append({**record, "type": kind})
        warnings = [
            "Visual preview is a text projection, not a Word layout renderer.",
            "Paragraph snippets are reserialized; the Raw XML tab preserves decoded source text.",
        ]
        if any(r["external"] for r in relationships):
            warnings.append("External relationships are listed only; no links are fetched.")
        if any(r["exists"] is False for r in relationships):
            warnings.append("Some internal relationship targets are missing from the archive.")
        result = {
            "filename": PurePosixPath(filename.replace("\\", "/")).name,
            "mainPart": main_path,
            "compressedBytes": len(data),
            "expandedBytes": expanded,
            "parts": parts,
            "relationships": relationships,
            "paragraphs": paragraphs,
            "comments": comments,
            "revisions": revisions,
            "summary": {
                "parts": len(parts),
                "xmlParts": len(roots),
                "paragraphs": len(paragraphs),
                "runs": sum(1 for _ in main.iter(q("r"))),
                "tables": sum(1 for _ in main.iter(q("tbl"))),
                "media": sum(1 for p in parts if "/media/" in p["path"]),
            },
            "steps": [
                {
                    "title": "Open ZIP container",
                    "detail": f"{len(data):,} bytes received; {len(parts)} package parts found.",
                },
                {
                    "title": "Validate package",
                    "detail": "Checked paths, expansion limits, content types, XML and document relationships.",
                },
                {"title": "Locate document", "detail": f"Root relationship resolves to {main_path}."},
                {
                    "title": "Read XML parts",
                    "detail": f"{len(roots)} XML / relationship parts decoded without changing source text.",
                },
                {
                    "title": "Map document text",
                    "detail": f"{len(paragraphs)} paragraphs mapped to WordprocessingML snippets.",
                },
            ],
            "warnings": warnings,
        }
        if len(json.dumps(result, ensure_ascii=False).encode()) > limits.response_bytes:
            raise DocxError("Inspection result exceeds the response limit. Use the CLI for this document.")
        return result


def xml_bundle(data, filename="document.docx", limits=DEFAULT_LIMITS):
    result = inspect_docx(data, filename, limits)
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for part in result["parts"]:
            if part["kind"] == "xml":
                target.writestr(part["path"], source.read(part["path"]))
    return output.getvalue()


def xml_part(data, path, filename="document.docx", limits=DEFAULT_LIMITS):
    """Return original bytes for one validated XML part."""
    result = inspect_docx(data, filename, limits)
    if not any(p["path"] == path and p["kind"] == "xml" for p in result["parts"]):
        raise DocxError("XML part not found.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.read(path)
