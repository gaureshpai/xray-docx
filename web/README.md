# Browser SDK

`sdk.mjs` reads DOCX packages and exports original parts. `worker.mjs` runs it in a browser worker so inspection does not block the UI thread.

Run `npm run build`. No document-processing server or fixed website size cap.
