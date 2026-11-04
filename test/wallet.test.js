import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function fixture(t, dbPath = ":memory:") {
  const app = await createApp({ dbPath });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => app.close(r)));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function req(url, { method = "GET", data, cookie, key, origin } = {}) {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  }
  async function signup(email) {
    const r = await req("/api/auth/signup", {
      method: "POST",
      data: { name: "Test User", email, password: "long-test-password" },
    });
    assert.equal(r.status, 201);
    return r.cookie;
  }
  return { req, signup, app };
}
test("authentication, validation, private dashboard and logout", async (t) => {
  const { req, signup } = await fixture(t);
  assert.equal((await req("/api/dashboard")).status, 401);
  const cookie = await signup("one@example.com");
  assert.equal(
    (
      await req("/api/auth/login", {
        method: "POST",
        data: { email: "one@example.com", password: "wrong-password" },
      })
    ).status,
    401,
  );
  assert.equal(
    (await req("/api/dashboard", { cookie })).body.wallets.find(
      (w) => w.currency === "INR",
    ).balance,
    1000000,
  );
  assert.equal(
    (
      await req("/api/auth/signup", {
        method: "POST",
        data: { name: "User", email: "two@example.com", password: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await req("/api/auth/logout", { method: "POST", data: {}, cookie }))
      .status,
    200,
  );
  assert.equal((await req("/api/dashboard", { cookie })).status, 401);
});
test("conversion rounding, balance protection and idempotency", async (t) => {
  const { req, signup } = await fixture(t),
    cookie = await signup("one@example.com");
  const options = {
    method: "POST",
    cookie,
    key: "conversion-001",
    data: { from: "INR", to: "USD", amount: "832.00" },
  };
  const a = await req("/api/convert", options);
  assert.equal(a.body.converted, 1000);
  assert.deepEqual((await req("/api/convert", options)).body, a.body);
  let d = (await req("/api/dashboard", { cookie })).body;
  assert.equal(d.wallets.find((w) => w.currency === "INR").balance, 916800);
  assert.equal(d.wallets.find((w) => w.currency === "USD").balance, 1000);
  assert.equal(
    (
      await req("/api/convert", {
        ...options,
        data: { ...options.data, amount: "833" },
      })
    ).status,
    409,
  );
  for (const amount of ["-1", "0", "NaN", "0.001", "1000001"])
    assert.equal(
      (
        await req("/api/convert", {
          ...options,
          key: "invalid-amount",
          data: { from: "INR", to: "USD", amount },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await req("/api/convert", {
        ...options,
        key: "no-balance",
        data: { from: "EUR", to: "USD", amount: "1" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req("/api/convert", {
        ...options,
        key: "same-currency",
        data: { from: "INR", to: "INR", amount: "1" },
      })
    ).status,
    400,
  );
});
test("transfers conserve funds, isolate history and cannot double spend", async (t) => {
  const { req, signup } = await fixture(t),
    sender = await signup("sender@example.com"),
    receiver = await signup("receiver@example.com");
  const options = {
    method: "POST",
    cookie: sender,
    key: "transfer-0001",
    data: { email: "receiver@example.com", currency: "INR", amount: "7500" },
  };
  assert.equal((await req("/api/transfers", options)).status, 201);
  assert.equal((await req("/api/transfers", options)).status, 201);
  assert.equal(
    (await req("/api/transfers", { ...options, key: "transfer-0002" })).status,
    409,
  );
  const a = (await req("/api/dashboard", { cookie: sender })).body,
    b = (await req("/api/dashboard", { cookie: receiver })).body;
  assert.equal(a.wallets.find((w) => w.currency === "INR").balance, 250000);
  assert.equal(b.wallets.find((w) => w.currency === "INR").balance, 1750000);
  assert.equal(a.transactions.filter((x) => x.kind === "TRANSFER").length, 1);
  assert.equal(b.transactions.filter((x) => x.kind === "TRANSFER").length, 1);
  assert.notEqual(a.user.id, b.user.id);
});
test("cross-origin writes are rejected and cookies are HttpOnly", async (t) => {
  const { req, signup } = await fixture(t);
  const cookie = await signup("one@example.com");
  assert.equal(
    (
      await req("/api/auth/logout", {
        cookie,
        method: "POST",
        data: {},
        origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  const login = await req("/api/auth/login", {
    method: "POST",
    data: { email: "one@example.com", password: "long-test-password" },
  });
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
});
test("rate limit rejects repeated credential attempts", async (t) => {
  const { req } = await fixture(t);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await req("/api/auth/login", {
          method: "POST",
          data: { email: "absent@example.com", password: "wrong-password" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await req("/api/auth/login", {
        method: "POST",
        data: { email: "absent@example.com", password: "wrong-password" },
      })
    ).status,
    429,
  );
});
test("users and balances persist across process restarts", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "currencyswap-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "test.db");
  const first = await createApp({ dbPath: file });
  await new Promise((r) => first.listen(0, "127.0.0.1", r));
  await fetch(`http://127.0.0.1:${first.address().port}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Persistent User",
      email: "persist@example.com",
      password: "long-test-password",
    }),
  });
  await new Promise((r) => first.close(r));
  const { req } = await fixture(t, file);
  const login = await req("/api/auth/login", {
    method: "POST",
    data: { email: "persist@example.com", password: "long-test-password" },
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await req("/api/dashboard", { cookie: login.cookie })).body.wallets.find(
      (w) => w.currency === "INR",
    ).balance,
    1000000,
  );
});
