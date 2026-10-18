# Xray DOCX

Look inside a Word document with a **client-only website** or an offline Python CLI.

A DOCX is a ZIP package of XML and other files. The website opens it in a browser worker. Your document is not uploaded.

## Explore

- Raw XML, including `comments.xml` and tracked-change markup.
- Comments, insertions, deletions, and moves in Reviews.
- Paragraph-to-XML mappings and package relationships.
- Binary parts as hex previews, with original downloads.
- An XML-only ZIP preserving original part bytes.

No application file-size cap on the website. Device memory and ZIP support still set practical limits. The text view is not Word’s exact layout.

## Run the website

Node 24.15+ and Python 3.12+ for the local static server:

```sh
npm ci --ignore-scripts
npm run build
py -3 -m xray_docx.server
```

On macOS or Linux, use `python -m xray_docx.server` instead. Open http://127.0.0.1:8000. The server only serves static files; conversion runs in your browser.

## Use the offline CLI

Install the published package with `python -m pip install xray-docx`. It requires Python 3.12+ and has no production dependencies. On Windows, use `py -3` to run Python; on macOS or Linux, use `python`.

```sh
py -3 -m xray_docx report.docx
py -3 -m xray_docx report.docx --part word/document.xml
py -3 -m xray_docx report.docx --output xml-parts.zip
```

## Test and deploy

Run `npm test` and `py -3 -m unittest discover -v` on Windows (`python -m unittest discover -v` on macOS or Linux).

For real-browser checks, run `npx playwright install chromium firefox webkit`, then `npm run test:e2e`. CI runs Chromium, Firefox, WebKit, and a mobile Chromium viewport against built assets with the hosting security headers.

Vercel builds with `npm run build` and serves `public/`. No conversion functions, database, secrets, or migrations.

See the [architecture guide](docs/architecture.md), [technical details](docs/technical.md), and [contribution rules](CONTRIBUTING.md).

For the current audit branch and a short manual checklist, see [audit testing](docs/audit-testing.md).

CLI `--json` includes source-labelled `comments` and `revisions`, alongside raw parts and paragraph mappings. Both engines project current text without deleted/moved-from content; original XML retains all review markup and comment anchors.
