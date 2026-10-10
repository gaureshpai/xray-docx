# How it works

1. You choose a DOCX in the browser.
2. A worker uses the JavaScript SDK to read its ZIP package.
3. The SDK validates the package and maps text, comments, and revisions.
4. The page reads XML parts on demand and shows the results.
5. The worker prepares original part downloads or an XML ZIP.

No document bytes go to a server. Vercel only hosts static assets.

The Python CLI is separate and works offline. Its extraction service keeps bounded safety defaults.
