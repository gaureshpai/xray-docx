# DOCX Ray

Look inside a Word document using a website or an offline CLI.

A `.docx` is a ZIP package containing XML and other files. DOCX Ray opens that package and lets you see what each part does.

## What you can do

- Upload a DOCX or try the sample.
- Browse raw XML and package parts.
- Click a paragraph to see its XML.
- Explore how parts are connected.
- Download the original XML files as a ZIP.

The preview shows text and XML, not Word’s exact page layout.

## Run the website

Requires Python 3.12+. No app dependencies to install.

```sh
python -m docx_ray.server
```

Open http://127.0.0.1:8000. Web uploads can be up to 3 MB.

## Use the CLI

```sh
python -m docx_ray report.docx
python -m docx_ray report.docx --part word/document.xml
python -m docx_ray report.docx --output xml-parts.zip
```

The CLI works offline and accepts documents up to 20 MB.

## Project at a glance

| Folder | Purpose |
| --- | --- |
| `docx_ray/` | Shared Python engine, API routes, and CLI |
| `api/` | Vercel entrypoint |
| `public/` | Plain HTML, CSS, and JavaScript website |
| `tests/` | Extraction, safety, CLI, and HTTP tests |
| `docs/` | Optional deeper explanation |

## Test and deploy

Run `python -m unittest discover -v` for Python tests. For UI integration tests, run `npm ci --ignore-scripts` then `npm test`.

UI tests exercise the real API in a DOM environment; they do not check browser layout.

Vercel uses `public/` for the website and `api/index.py` for Python. No database, queue, secrets, or migrations are needed. GitHub CI checks changes on pushes and PRs.

Uploads are processed in memory; the app does not save them. Use the CLI for documents you want to keep offline.

See the [short architecture guide](docs/architecture.md), [technical details](docs/technical.md), and [contribution rules](CONTRIBUTING.md).
