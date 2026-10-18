# Xray DOCX CLI

Inspect the XML package inside a DOCX file without uploading it. The CLI uses only the Python standard library.

## Install

```sh
python -m pip install xray-docx
```

Requires Python 3.12 or later. The `xray-docx` command is installed with the package.

## Use

```sh
xray-docx report.docx
xray-docx report.docx --json
xray-docx report.docx --part word/document.xml
xray-docx report.docx --output xml-parts.zip
```

The command reports document structure and review markup, can print full inspection JSON or a formatted XML part, and can export XML parts to a ZIP while preserving their original bytes. It does not modify the source document.
