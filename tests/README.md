# Tests

`npm run test:e2e` runs real-browser uploads, review inspection, cancellation, downloads, byte comparisons, and a mobile viewport check. Install the browser engines with `npx playwright install chromium firefox webkit`. The test server applies the headers from `vercel.json`.

Run `npm test` for browser SDK and UI tests using the exact worker bundle. Tests include a DOCX larger than the old 3 MB cap, comments, tracked changes, binary parts, exact exports, and no document network requests. The DOM environment does not verify browser layout.

Run `python -m unittest discover -v` for offline CLI, XML safety, exports, and static-server tests.

`reviewed.docx` contains a generated comment and synthetic revision markup. The public python-docx fixture retains its license in `UPSTREAM-LICENSE`.
