# Test the audit changes

All four audit fixes are together on `audit/xml-validation`. The PRs are stacked in this order: package validation, review extraction, browser recovery, XML validation. Check the latest PR's Actions results for the tested commit.

## Open the website

With Node 24.15+ and Python 3.12+:

```sh
git fetch origin
git switch --track origin/audit/xml-validation
npm ci --ignore-scripts
npm run build
python -m docx_ray.server
```

Open http://127.0.0.1:8000.

## Quick checks

1. Try the sample, filter for `styles.xml`, and open its raw XML.
2. Open a document with comments and tracked edits. Check Reviews and each record's source path; raw parts remain available for all other markup.
3. Check text containing tabs/line breaks, deletions, and moved text.
4. Download a single original part and the XML ZIP. The tests compare these to the original DOCX bytes.
5. Cancel loading or processing, then open another document.
6. Try a document over 3 MB and a corrupt document. File capacity still depends on browser memory and supported ZIP formats.

## Repeat the automated checks

```sh
npm test
python -m unittest discover -v
npx playwright install chromium firefox webkit
npm run test:e2e
```

CI serves the built app with the configured hosting security headers. Its `browser-test-results` artifact contains synthetic screenshots and traces for failed cases.

The website remains client-only. These changes require no database migration, conversion server, or application secrets. The audit PRs are open for review; `main` is unchanged until they are merged. No hosted preview URL is claimed.
