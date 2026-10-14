# Test the audit changes

The audit changes are consolidated in PR #5 for `main`. It covers package validation, review extraction, browser recovery, XML validation, archive fidelity, and large-document handling. Check PR #5's latest Actions results for the tested commit.

## Open the website

With Node 24.15+ and Python 3.12+:

```sh
git fetch origin
git switch main
git pull --ff-only
npm ci --ignore-scripts
npm run build
py -3 -m docx_ray.server
```

On macOS or Linux, use `python -m docx_ray.server` instead.

Open http://127.0.0.1:8000.

## Quick checks

1. Try the sample, filter for `styles.xml`, and open its raw XML.
2. Open a document with comments and tracked edits. Check Reviews, including multi-paragraph comments and blank lines; use **Open source part** to jump to each record's raw XML.
3. Check text containing tabs/line breaks, deletions, and moved text. Deleted table rows/cells should appear under Reviews and raw snippets while their current-text entries are blank. Removed text boxes remain accessible as raw paragraph snippets without exposing their text in the current-text projection.
4. Download a single original part and the XML ZIP. The tests compare these to the original DOCX bytes.
5. Cancel loading or processing, then open another document.
6. Try a document over 3 MB and a corrupt document. File capacity still depends on browser memory and supported ZIP formats.
7. Try a document with many paragraphs and inspect its last paragraph. Duplicate ZIP entries are rejected rather than silently overwritten.

## Repeat the automated checks

```sh
npm test
py -3 -m unittest discover -v  # Windows; use python -m unittest discover -v elsewhere
npx playwright install chromium firefox webkit
npm run test:e2e
```

CI serves the built app with the configured hosting security headers. Its `browser-test-results` artifact contains synthetic screenshots and traces for failed cases.

The website remains client-only. These changes require no database migration, conversion server, or application secrets. Use `main` after PR #5 is merged. No hosted preview URL is claimed.

## Check CLI reviews

On Windows, run these commands with `py -3`; on macOS or Linux, use `python`.

```sh
py -3 -m docx_ray.cli reviewed.docx --json
py -3 -m docx_ray.cli reviewed.docx --part word/comments.xml
py -3 -m docx_ray.cli reviewed.docx --output original-xml.zip
```

JSON includes `comments` and `revisions` with source part, ID, author, date, text and XML snippets. Comment anchors and additional review/thread metadata remain in original raw XML. The CLI retains documented safety limits and rejects malformed XML; the website has no fixed size/count cap. Shared fixtures compare both engines, including renamed comment parts, headers, strict namespaces and UTF-16/32 comments, and compare both exports to original bytes.
