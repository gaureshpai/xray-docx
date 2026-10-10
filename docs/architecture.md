# How it works

1. The website or CLI receives a DOCX.
2. The shared engine opens its ZIP package in memory.
3. It validates the package and reads the XML parts.
4. It finds the main document using the package relationships.
5. It maps paragraphs to XML and returns the result.

The website displays the result. The CLI prints it or saves an XML ZIP.

The backend separates models, routes, and document processing. It has no database because there is nothing to store.

The XML ZIP keeps original part bytes. The visual paragraph snippets are reserialized for display. Neither mode changes the input DOCX.
