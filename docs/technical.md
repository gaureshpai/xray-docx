# Technical reference

## Website

`web/archive.mjs` validates the complete ZIP catalog before JSZip's file map can overwrite duplicate or normalized names. It rejects ambiguous entries, unsafe paths and entry-count mismatches, with no fixed size/count cap. The adapter uses internals from the exactly pinned JSZip version; archive regressions are required when upgrading that dependency. The public loader still verifies CRCs.

`web/sdk.mjs` is a browser-compatible SDK using pinned JSZip and xmldom dependencies. `web/worker.mjs` runs it outside the page’s UI thread. `public/sdk-client.js` manages requests and cancellation. `public/app.js` renders results using text nodes.

`npm run build` bundles the SDK and dependencies into `public/worker.js`. Vercel hosts only `public/`; there are no conversion API routes or functions. Selected documents and generated exports stay in browser memory. The sample button fetches the public sample DOCX, but inspection does not upload it.

No fixed website cap is imposed on file size, expanded size, entry count, or response size. Browser memory, typed-array/ZIP library support, malformed packages, and supported encodings still matter. A worker can be cancelled; it does not turn finite device memory into unlimited capacity. Very large packages may fail or exhaust browser memory.

## What is preserved

The paragraph projection retains tabs and line breaks and omits deleted/moved-from text. Reviews retain source order within each part and label their original package path. Comment parts are discovered by content types and relationships; common revision records are inspected across WordprocessingML parts, including headers and footers. Raw XML remains the complete source for markup beyond the parsed review records.

Required package/main XML is rejected when parsing reports malformed markup or forbidden literal control characters. Optional review parts that cannot be parsed are listed in warnings; their raw source and original download/export bytes remain available.

XML traversal pushes children individually, and large UI collections are assembled in document fragments. This avoids JavaScript's function-argument ceiling when a document contains many sibling runs, paragraphs, or review records. Device memory still determines practical capacity.

Raw parts retain decoded source XML without pretty-printing or reserialization. Original downloads and XML ZIP exports retain source part bytes. Binary parts have a 512-byte hex preview and a full original download. The XML ZIP excludes binary files by design.

UTF-8, browser-supported declared encodings, UTF-16, and BOM-marked UTF-32 are decoded. An undecodable part remains available as bytes and hex. Paragraph and review snippets are reserialized and can have different namespace formatting.

The explorer includes XML parts identified by filename or package content type: document, styles, numbering, settings, comments, footnotes, endnotes, headers, footers, metadata, custom XML, and relationship files when present. There is no single XML file containing every DOCX component.

Reviews parses comment elements from matching comment parts and common revision types in the main document: insertion, deletion, move-from, move-to, and selected formatting changes. It is not a complete semantic Word review renderer. Extended comment/threading metadata and revisions in other parts remain available in Raw parts.

The text projection omits deleted text, including nested text-box paragraphs with deleted/moved-from ancestors. Their paragraph indices and raw snippets remain available. Reviews preserve paragraph boundaries and blank paragraphs; each card can open its original source part. Reviews and Raw parts expose deletion markup. Layout, fields, numbering, merged tables, drawings, and pagination are not rendered as Word renders them.

JSZip verifies entry CRCs. Encrypted, unsupported ZIP variants and macro-enabled/legacy document formats are rejected. External relationships are never fetched. DTD/entity declarations are never parsed; affected parts remain available as raw XML or original bytes.

## CLI

The CLI validates original ZIP entry names before Python can truncate them at a null byte. It reads binary parts in chunks of at most 1 MiB to check declared sizes, local headers and CRCs without retaining binary contents in the inspection result. Corrupted binary parts reject the package before JSON output or XML export.

Python 3.12+, no production dependencies. `docx_ray/service.py` performs bounded ZIP/XML inspection. `models.py` defines CLI safety defaults. `cli.py` prints parts, structured comment/revision JSON or exports original XML bytes. Review extraction covers the same common revision types as the browser, with source paths and current-text projection. Content types identify XML parts even with nonstandard extensions; decoded UTF-16/32 XML is parsed without changing original export bytes. The CLI retains a 20 MB input limit, 50 MB expansion limit, 20 MB combined XML limit, 512 entries, and a nesting guard; these do not apply to the client-only website.

## Tests

`npm test` builds the exact worker bundle, tests SDK byte preservation and a valid document above 3 MB, and exercises the page with that worker in JSDOM. It checks comments, tracked changes, binary downloads, Unicode, errors, and no document network requests. These tests do not verify real-browser layout.

`python -m unittest discover -v` checks CLI extraction, safety, and XML exports. Static-server tests confirm there is no document-processing API.

`public/sample.docx` contains synthetic content. `tests/reviewed.docx` contains a generated comment and synthetic tracked-change XML. `tests/upstream.docx` comes from python-docx commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7`; its MIT license is retained.

## Deploy and metadata

Vercel: framework Other, build `npm run build`, output `public/`. No server, queue, environment variables, or migration. Source repository privacy and hosted-site access are separate settings.

The connection returned 403 Forbidden for the intended Vercel scope during this session; a live deployment has not been verified. The GitHub plugin cannot edit About metadata. The optional `bash scripts/configure_repo.sh <verified-live-url>` uses your authenticated GitHub CLI to apply prepared description, topics, and website URL.

There is no script here that resets ChatGPT usage limits or restarts this chat agent.
