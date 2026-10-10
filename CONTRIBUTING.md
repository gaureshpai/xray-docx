# Contributing

Keep browser extraction in `web/sdk.mjs`, worker messages in `web/worker.mjs`, and UI rendering in `public/`. Python under `docx_ray/` is for the offline CLI and local static hosting.

Never send document bytes over the network, fetch external relationships, or insert document content with `innerHTML`. Keep raw XML, original bytes, and reserialized snippets distinct.

Run `npm test`, `python -m unittest discover -v`, `python -m ruff check .`, and `python -m ruff format --check .`. Add regression tests when changing ZIP/XML handling. Keep fixtures synthetic or attributed.
