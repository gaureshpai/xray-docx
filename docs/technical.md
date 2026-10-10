# DOCX Ray

A small website and offline CLI for looking inside a `.docx` file. The backend is Python 3.12+ with **no production dependencies**. The frontend is plain HTML, CSS, and JavaScript. Both interfaces use one inspection service.

## Run locally

```sh
python -m docx_ray.server
```

Open http://127.0.0.1:8000 and choose a DOCX or try the included sample.

## CLI

From the repository root, no installation is required:

```sh
python -m docx_ray report.docx
python -m docx_ray report.docx --json
python -m docx_ray report.docx --part word/document.xml
python -m docx_ray report.docx --output xml-parts.zip
```

Or install into a virtual environment with `python -m pip install .`, then use `docx-ray report.docx`. Output ZIPs use exclusive creation: choose a new path to avoid overwriting existing files.

## What “conversion” means

DOCX already contains multiple XML parts in a ZIP package. DOCX Ray exposes those parts, rather than inventing a single replacement XML format. `word/document.xml` is common, but the service resolves the main document from the package relationship instead of assuming its location.

- Raw XML preserves decoded source text, whitespace, and namespace prefixes. UTF-8 and BOM-marked UTF-16/32 are supported.
- The all-XML ZIP export preserves each original XML and `.rels` entry **byte for byte**, including its encoding. Binary media are inventoried but excluded from this XML-only export.
- Single-part downloads also preserve original XML bytes and encoding.
- Paragraph snippets are reserialized and may use `ns0` prefixes. The preview is a text projection and does not reproduce page layout, typography, images, numbering, or tables as Word renders them.
- The walkthrough replays completed inspection steps. It is not live server progress.
- Headers, footers, styles, metadata, and other XML remain available in the explorer. Paragraph mappings show the main document only.
- External relationship targets are displayed as text and never requested.

## Structure

```text
api/index.py             Vercel Python entrypoint
docx_ray/models.py       Errors and resource limit model
docx_ray/service.py      ZIP validation, XML inspection, export
docx_ray/routes.py       HTTP routing and transport validation
docx_ray/server.py       Local HTTP and static asset server
docx_ray/cli.py          Offline CLI
public/                 HTML, CSS, JS, and synthetic sample
tests/                  Engine, security, HTTP and CLI tests
scripts/                Sample generation and verification
.github/workflows/      CI
```

There is no database or persistent upload model because inspection is read-only and request-scoped.

## API

- `GET /api/health` returns runtime version and upload limit.
- `POST /api/inspect` returns package inventory, decoded XML, paragraph mappings, relationships, warnings, and completed steps.
- `POST /api/part?path=word/document.xml` returns the original bytes of an XML part.
- `POST /api/export` returns an XML-only ZIP with original part bytes.

POST requests send raw DOCX bytes with `Content-Type: application/octet-stream` and an optional URL-encoded `X-Filename` ending in `.docx`.

```sh
curl -X POST http://127.0.0.1:8000/api/inspect \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: sample.docx' --data-binary @public/sample.docx
```

## Limits and privacy

Web: 3,000,000 input bytes, 12,000,000 expanded bytes, 512 ZIP entries, 3,000,000 combined XML bytes, 4,000,000 response bytes, 100 levels of XML nesting. CLI: 20 MB input, 50 MB expanded, 20 MB XML, 100 MB response. Macro-enabled DOCM, legacy DOC, encrypted archives, DTD/entities, duplicate entries, symlinks, unsafe paths, and unsupported compression are rejected. Only ZIP store/deflate compression is accepted.

Web uploads are processed in server memory; this application does not persist or log document contents or filenames. Vercel remains the hosting provider receiving upload bytes. Use the CLI for offline inspection. Deploy behind access control if hosting for sensitive internal documents. There is no application authentication or rate limiter in this initial version.

## Tests

```sh
python -m unittest discover -v
node --check public/app.js
```

Tests include the generated sample, a real upstream DOCX, source XML comparisons, byte-preserving exports, relationships, Unicode, unsafe archives, resource limits, CLI execution, and real local HTTP requests. CI runs these checks on pushes and PRs.

The sample can be regenerated with `python -m pip install python-docx` then `python scripts/create_sample.py`; this dependency is for sample generation only. The committed fixture avoids requiring it for tests.

## Vercel

Import this private GitHub repository into the intended Vercel account. Framework: Other. Output directory: `public`. No frontend build command or environment variables are needed. `api/index.py` uses Vercel’s Python `BaseHTTPRequestHandler` runtime, with API rewrites configured in `vercel.json`. Processing runs within a single request; no queue or asynchronous processor is needed for the supported limits.

Git integration deploys subsequent changes. CI tests and Vercel builds are independent; configure Deployment Checks in Vercel if you want CI to gate production releases. Repository privacy does not automatically make the production website private.

See [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python) and [OOXML package overview](https://learn.microsoft.com/en-us/office/open-xml/general/how-to-create-a-package).

## Fixture provenance

`public/sample.docx` contains synthetic demonstration content generated by `scripts/create_sample.py`. `tests/upstream.docx` is the python-docx project's `tests/test_files/test.docx` at commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7`. The upstream MIT license is retained in `tests/UPSTREAM-LICENSE`.

## Resuming interrupted work

The source, fixtures, tests, and CI remain in GitHub. Running `python -m unittest discover -v` resumes verification; a push to the connected branch triggers a new Vercel build. There is no script that can reset ChatGPT usage limits or restart this chat agent, and this repository does not claim to provide one.
