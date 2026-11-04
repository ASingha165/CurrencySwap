import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CURRENCIES = { INR: 1, USD: 83.2, EUR: 90.1, GBP: 104, JPY: 0.57 };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const cookieName = "currencyswap_session";
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const requireThat = (condition, message, status = 400) => {
  if (!condition) throw new ApiError(status, message);
};
const emailOf = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const validCurrency = (value) => {
  requireThat(Object.hasOwn(CURRENCIES, value), "Unsupported currency.");
  return value;
};
function minorUnits(value) {
  requireThat(
    typeof value === "string" || typeof value === "number",
    "Enter a valid amount.",
  );
  const text = String(value);
  requireThat(
    /^\d{1,9}(\.\d{1,2})?$/.test(text),
    "Amount must be positive with at most two decimal places.",
  );
  const amount = Math.round(Number(text) * 100);
  requireThat(
    amount > 0 && amount <= 100000000,
    "Amount must be between 0.01 and 1,000,000.",
  );
  return amount;
}
export async function createApp({
  dbPath = process.env.DB_PATH || path.join(ROOT, "data", "wallet.db"),
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  if (dbPath !== ":memory:")
    await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets(user_id TEXT NOT NULL REFERENCES users(id),currency TEXT NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0),PRIMARY KEY(user_id,currency));
    CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,currency TEXT NOT NULL,amount INTEGER NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tx_user_date ON transactions(user_id,created);
    CREATE TABLE IF NOT EXISTS operations(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,key));`);
  const attempts = new Map();
  function rateLimit(req, email) {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    const key = req.socket.remoteAddress;
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    requireThat(
      item.count < 10,
      "Too many attempts. Try again in 15 minutes.",
      429,
    );
    item.count++;
    attempts.set(key, item);
  }
  function userFor(req) {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    requireThat(raw, "Please sign in.", 401);
    const user = db
      .prepare(
        "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      )
      .get(hash(raw), Date.now());
    requireThat(user, "Your session expired. Please sign in.", 401);
    return user;
  }
  function session(res, id) {
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      id,
      Date.now() + 86400000,
    );
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secureCookies ? "; Secure" : ""}`,
    );
  }
  function record(userId, kind, currency, amount, detail) {
    db.prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?)").run(
      randomUUID(),
      userId,
      kind,
      currency,
      amount,
      detail,
      new Date().toISOString(),
    );
  }
  function operation(req, user, body, run) {
    const key = req.headers["idempotency-key"];
    requireThat(
      typeof key === "string" && /^[\w-]{8,100}$/.test(key),
      "An idempotency key is required.",
    );
    const payload = JSON.stringify({ route: req.url, body });
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare("SELECT * FROM operations WHERE user_id=? AND key=?")
        .get(user.id, key);
      if (existing) {
        requireThat(
          existing.payload === payload,
          "This request key was already used for another operation.",
          409,
        );
        db.exec("COMMIT");
        return JSON.parse(existing.result);
      }
      const result = run();
      db.prepare("INSERT INTO operations VALUES(?,?,?,?)").run(
        user.id,
        key,
        payload,
        JSON.stringify(result),
      );
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function debit(id, currency, amount) {
    const result = db
      .prepare(
        "UPDATE wallets SET balance=balance-? WHERE user_id=? AND currency=? AND balance>=?",
      )
      .run(amount, id, currency, amount);
    requireThat(result.changes === 1, "Insufficient balance.", 409);
  }
  function credit(id, currency, amount) {
    db.prepare(
      "UPDATE wallets SET balance=balance+? WHERE user_id=? AND currency=?",
    ).run(amount, id, currency);
  }
  async function bodyOf(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      requireThat(Buffer.byteLength(raw) <= 16384, "Request too large.", 413);
    }
    try {
      const body = JSON.parse(raw);
      requireThat(
        body && typeof body === "object" && !Array.isArray(body),
        "JSON object required.",
      );
      return body;
    } catch {
      throw new ApiError(400, "Send a valid JSON object.");
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        requireThat(req.method === "GET", "Method not allowed.", 405);
        const file =
          { "/app.js": "app.js", "/app.css": "app.css" }[url.pathname] ||
          "index.html";
        const content = await readFile(path.join(ROOT, "public", file));
        res.writeHead(200, {
          "Content-Type": file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
          "Cache-Control": "no-cache",
        });
        return res.end(content);
      }
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        requireThat(
          req.headers["sec-fetch-site"] !== "cross-site",
          "Cross-site request rejected.",
          403,
        );
        if (origin)
          requireThat(
            new URL(origin).host === req.headers.host,
            "Cross-site request rejected.",
            403,
          );
        requireThat(
          req.headers["content-type"]?.startsWith("application/json"),
          "Content-Type must be application/json.",
          415,
        );
      }
      if (url.pathname === "/api/health" && req.method === "GET")
        return send(200, { status: "ok", mode: "simulation" });
      if (
        ["/api/auth/signup", "/api/auth/login"].includes(url.pathname) &&
        req.method === "POST"
      ) {
        const body = await bodyOf(req),
          email = emailOf(body.email),
          password = body.password;
        rateLimit(req, email);
        requireThat(
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254,
          "Enter a valid email.",
        );
        requireThat(
          typeof password === "string" &&
            password.length >= 10 &&
            password.length <= 128,
          "Password must be 10–128 characters.",
        );
        let user;
        if (url.pathname.endsWith("signup")) {
          const name = String(body.name || "").trim();
          requireThat(
            name.length >= 2 && name.length <= 80,
            "Name must be 2–80 characters.",
          );
          requireThat(
            !db.prepare("SELECT id FROM users WHERE email=?").get(email),
            "Email already registered.",
            409,
          );
          const salt = randomBytes(16).toString("hex"),
            id = randomUUID();
          const digest = scryptSync(password, salt, 64).toString("hex");
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
              id,
              name,
              email,
              digest,
              salt,
            );
            for (const currency of Object.keys(CURRENCIES))
              db.prepare("INSERT INTO wallets VALUES(?,?,?)").run(
                id,
                currency,
                currency === "INR" ? 1000000 : 0,
              );
            record(
              id,
              "WELCOME",
              "INR",
              1000000,
              "Welcome credit · simulated funds",
            );
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          user = { id, name, email };
        } else {
          const found = db
            .prepare("SELECT * FROM users WHERE email=?")
            .get(email);
          const digest = scryptSync(
            password,
            found?.salt || "dummy-authentication-salt",
            64,
          );
          requireThat(
            found &&
              timingSafeEqual(digest, Buffer.from(found.password, "hex")),
            "Invalid email or password.",
            401,
          );
          user = { id: found.id, name: found.name, email: found.email };
        }
        session(res, user.id);
        return send(url.pathname.endsWith("signup") ? 201 : 200, { user });
      }
      const user = userFor(req);
      if (url.pathname === "/api/auth/me" && req.method === "GET")
        return send(200, { user });
      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        const raw = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(cookieName + "="))
          ?.slice(cookieName.length + 1);
        db.prepare("DELETE FROM sessions WHERE token=?").run(hash(raw));
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`,
        );
        return send(200, { success: true });
      }
      if (url.pathname === "/api/dashboard" && req.method === "GET") {
        const wallets = db
          .prepare("SELECT currency,balance FROM wallets WHERE user_id=?")
          .all(user.id);
        const transactions = db
          .prepare(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT 100",
          )
          .all(user.id);
        return send(200, {
          user,
          wallets,
          transactions,
          rates: CURRENCIES,
          rateSource:
            "Illustrative fixed rates, INR per unit · not market quotes",
          mode: "simulation",
        });
      }
      if (url.pathname === "/api/convert" && req.method === "POST") {
        const body = await bodyOf(req),
          from = validCurrency(body.from),
          to = validCurrency(body.to),
          amount = minorUnits(body.amount);
        requireThat(from !== to, "Choose two different currencies.");
        const converted = Math.round(
          (amount * CURRENCIES[from]) / CURRENCIES[to],
        );
        requireThat(converted > 0, "Amount is too small to convert.");
        return send(
          200,
          operation(req, user, body, () => {
            debit(user.id, from, amount);
            credit(user.id, to, converted);
            record(
              user.id,
              "CONVERT",
              from,
              -amount,
              `Converted to ${(converted / 100).toFixed(2)} ${to}`,
            );
            record(
              user.id,
              "CONVERT",
              to,
              converted,
              `Converted from ${(amount / 100).toFixed(2)} ${from}`,
            );
            return { success: true, converted, currency: to };
          }),
        );
      }
      if (url.pathname === "/api/transfers" && req.method === "POST") {
        const body = await bodyOf(req),
          currency = validCurrency(body.currency),
          amount = minorUnits(body.amount);
        const recipient = db
          .prepare("SELECT id,email FROM users WHERE email=?")
          .get(emailOf(body.email));
        requireThat(
          recipient && recipient.id !== user.id,
          "Enter another registered account’s email.",
        );
        return send(
          201,
          operation(req, user, body, () => {
            debit(user.id, currency, amount);
            credit(recipient.id, currency, amount);
            record(
              user.id,
              "TRANSFER",
              currency,
              -amount,
              `To ${recipient.email}`,
            );
            record(
              recipient.id,
              "TRANSFER",
              currency,
              amount,
              `From ${user.email}`,
            );
            return { success: true };
          }),
        );
      }
      throw new ApiError(404, "Endpoint not found.");
    } catch (e) {
      if (!e.status) console.error("Request failed:", e.message);
      send(e.status || 500, {
        error: e.status ? e.message : "Something went wrong. Please try again.",
      });
    }
  });
  server.on("close", () => db.close());
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createApp();
  server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        "CurrencySwap running at http://localhost:" +
          (process.env.PORT || 3000),
      ),
  );
}
