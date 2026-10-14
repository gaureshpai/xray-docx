# Contributing

Keep browser extraction in `web/sdk.mjs`, worker messages in `web/worker.mjs`, and UI rendering in `public/`. Python under `docx_ray/` is for the offline CLI and local static hosting.

Never send document bytes over the network, fetch external relationships, or insert document content with `innerHTML`. Keep raw XML, original bytes, and reserialized snippets distinct.

Run `npm test`, `py -3 -m unittest discover -v`, `py -3 -m ruff check .`, and `py -3 -m ruff format --check .` on Windows. On macOS or Linux, replace `py -3` with `python`. Add regression tests when changing ZIP/XML handling. Keep fixtures synthetic or attributed.
