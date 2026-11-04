# Project guide

CurrencySwap is a simulated wallet application, not real payment infrastructure.

- Runtime: Node 24+, built-in HTTP/SQLite/crypto; no external runtime dependencies.
- `server.js` owns authentication, persistence and financial demo rules. `public/` is the browser app.
- Keep credentials server-side and session cookies HttpOnly. Store session token hashes only.
- Derive account identity from the verified session. Never accept a sender ID from request data.
- Monetary values in storage are integer minor units. Keep debit, credit, history and idempotency recording in one transaction.
- Rates must remain explicitly labelled illustrative unless a real provider is implemented.
- Run `npm test` and syntax checks after backend changes; browser-smoke signup, conversion, transfer and logout after UI changes.
- Persistent DB files and secrets must not enter git.
- 2026-11-04: replaced static mockup with signup/login, wallets, atomic exchanges/transfers, history and CSV export. Verification results are recorded in the PR.
