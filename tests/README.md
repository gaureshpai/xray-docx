# Tests

Run `python -m unittest discover -v` from the repository root.

Tests cover XML accuracy, exports, package safety, CLI commands, and real HTTP requests. The fixtures include our synthetic sample and a DOCX from python-docx; its license is in `UPSTREAM-LICENSE`.

Run `npm ci --ignore-scripts` and `npm test` for UI integration tests against the real Python API. These test interactions and responses, not browser layout.
