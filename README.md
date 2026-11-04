# CurrencySwap

A working multi-currency wallet sandbox: create an account, exchange simulated funds, transfer to another registered user, search activity, and export CSV.

**No real money moves.** Rates are illustrative fixed values, not live market prices. New accounts receive INR 10,000 in simulated funds. All supported wallets use two decimal places, including JPY for this sandbox.

## Run in VS Code

Requires Node.js 24 or newer. No npm dependencies or API keys required.

1. Open this folder in VS Code.
2. In the integrated terminal, run `npm start`.
3. Open http://localhost:3000 and create an account.
4. Create a second account in another browser/profile to try transfers.

`npm run dev` restarts the server on code changes. `npm test` runs integration tests using isolated SQLite databases.

## Features and architecture

- Responsive dashboard with five wallets: INR, USD, EUR, GBP, JPY.
- Persistent SQLite database in `data/wallet.db`; mount this directory on persistent storage when hosting.
- Integer minor-unit balances; conversions round the destination amount to the nearest minor unit.
- Atomic debit/credit and transaction history in SQLite transactions.
- Required idempotency keys for conversion and transfer; retries with the same key and payload return the saved result. A changed payload with the same key returns 409.
- Search and CSV export cover the latest 100 account-specific transaction entries.
- Plain HTML/CSS/JavaScript frontend and Node HTTP backend; no build step, external fonts or CDN scripts.

## Authentication

Passwords use salted scrypt hashes. Random 256-bit session tokens are stored as SHA-256 hashes in SQLite. The browser receives an HttpOnly, SameSite=Strict cookie, expiring after 24 hours. Logout deletes its server session. No credentials or auth tokens are stored in localStorage.

Writes require JSON and reject foreign origins/cross-site requests. Authentication endpoints are limited to 10 attempts per remote IP per 15 minutes in each process. Deploy one process or add a shared rate limiter at the edge. When using a reverse proxy, the remote address may be the proxy: configure edge limiting accordingly; arbitrary forwarded headers are deliberately not trusted.

## API

All responses are JSON. Errors use `{ "error": "message" }`. Authenticated endpoints use the session cookie.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Public health and simulation status |
| POST | `/api/auth/signup` | `{name,email,password}`; password 10–128 characters |
| POST | `/api/auth/login` | `{email,password}` |
| GET | `/api/auth/me` | Current account |
| POST | `/api/auth/logout` | Invalidate current session |
| GET | `/api/dashboard` | Account wallets, latest 100 transactions, illustrative rates |
| POST | `/api/convert` | `{from,to,amount}` with `Idempotency-Key` header |
| POST | `/api/transfers` | `{email,currency,amount}` with `Idempotency-Key` header |

Amounts accept at most two decimal places, from 0.01 to 1,000,000. Unsupported currencies, insufficient funds and self-transfers are rejected. The backend derives the sender from the session; the client cannot select another sender.

## Hosting

- `PORT` defaults to `3000`; `HOST` defaults to `127.0.0.1` (use `0.0.0.0` in containers).
- `DB_PATH` optionally overrides the SQLite file path.
- Set `NODE_ENV=production` behind HTTPS to enable Secure cookies. Do not use production mode over plain HTTP.
- `docker build -t currencyswap .` then `docker run --rm -p 3000:3000 -v currencyswap-data:/app/data currencyswap` runs a local HTTP demo. Use `-e NODE_ENV=production` only with an HTTPS reverse proxy.
- Back up the database using SQLite-aware tooling. Do not host writable SQLite files on ephemeral serverless storage or network filesystems.

## Scope

This is a functional portfolio/demo application, not a bank or payment processor. No live-rate provider, bank integration, password reset, email verification or real settlement is included. Conversion loops can gain/lose rounding cents; balances have no monetary value. Existing static mock pages were replaced by the application in `public/`; old page URLs served through this server resolve to the new app.
