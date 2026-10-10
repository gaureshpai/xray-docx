# Python backend and CLI

- `models.py`: errors and size limits.
- `service.py`: inspect a DOCX and export XML.
- `routes.py`: handle API requests.
- `server.py`: run the website locally.
- `cli.py`: run the same engine offline.

Both the website and CLI call the same service. No production dependencies or database are needed.
