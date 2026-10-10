# Contributing

Keep extraction rules in `docx_ray/service.py`, resource limits and error models in `models.py`, transport behavior in `routes.py`, and the CLI independent of HTTP. Use Python 3.12+, four-space indentation, explicit resource limits, and context managers for files. The backend has no production third-party dependencies.

Never write uploaded ZIP paths to disk, fetch external relationships, log document contents, or insert document XML through `innerHTML`. Raw source XML and reserialized snippets have different contracts; preserve that distinction in tests and UI copy.

Run `python -m unittest discover -v`, `node --check public/app.js`, and `python -m compileall -q docx_ray api scripts` before committing. Add regression cases for altered XML, ZIP safety or response schema changes. Keep examples synthetic, and retain upstream fixture attribution.
