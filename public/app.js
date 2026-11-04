const $ = (id) => document.getElementById(id);
let signup = false,
  dashboard,
  pendingTransfer;
const money = (minor, currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").className = error ? "error" : "";
  $("notice").hidden = false;
}
async function api(url, data, key) {
  const response = await fetch(url, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) showAuth();
    throw new Error(result.error || "Request failed.");
  }
  return result;
}
function showAuth() {
  dashboard = null;
  $("dashboard").hidden = true;
  $("auth").hidden = false;
  $("logout").hidden = true;
  $("transactions").replaceChildren();
  $("wallets").replaceChildren();
}
function setMode(value) {
  signup = value;
  $("nameLabel").hidden = !value;
  $("name").required = value;
  $("authTitle").textContent = value ? "Start exploring" : "Welcome back";
  $("authHint").textContent = value
    ? "Create your personal sandbox wallet."
    : "Sign in to your personal wallet.";
  $("authSubmit").textContent = value ? "Create account →" : "Sign in →";
  $("password").autocomplete = value ? "new-password" : "current-password";
  $("loginTab").classList.toggle("selected", !value);
  $("signupTab").classList.toggle("selected", value);
}
async function busy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    notice(e.message, true);
  } finally {
    button.disabled = false;
  }
}
async function refresh() {
  dashboard = await api("/api/dashboard");
  const order = Object.keys(dashboard.rates);
  dashboard.wallets.sort(
    (a, b) => order.indexOf(a.currency) - order.indexOf(b.currency),
  );
  $("auth").hidden = true;
  $("dashboard").hidden = false;
  $("logout").hidden = false;
  $("greeting").textContent = `Hello, ${dashboard.user.name.split(" ")[0]}.`;
  $("wallets").replaceChildren(
    ...dashboard.wallets.map((wallet) => {
      const el = document.createElement("div");
      el.className = "wallet";
      const label = document.createElement("span");
      label.textContent = wallet.currency;
      const amount = document.createElement("strong");
      amount.textContent = money(wallet.balance, wallet.currency);
      const hint = document.createElement("small");
      hint.textContent = "SIMULATED BALANCE";
      el.append(label, amount, hint);
      return el;
    }),
  );
  for (const id of ["from", "to", "transferCurrency"])
    if (!$(id).options.length)
      for (const cur of Object.keys(dashboard.rates))
        $(id).add(new Option(cur, cur));
  if ($("from").value === $("to").value) $("to").value = "USD";
  renderTransactions();
  quote();
}
function renderTransactions() {
  const filter = $("search").value.toLowerCase();
  $("transactions").replaceChildren(
    ...dashboard.transactions
      .filter((t) =>
        `${t.detail} ${t.currency} ${t.kind}`.toLowerCase().includes(filter),
      )
      .map((t) => {
        const tr = document.createElement("tr");
        for (const text of [
          new Date(t.created).toLocaleString(),
          t.detail,
          t.kind,
          `${t.amount > 0 ? "+" : ""}${money(t.amount, t.currency)}`,
        ]) {
          const td = document.createElement("td");
          td.textContent = text;
          tr.append(td);
        }
        tr.lastChild.className = `amount ${t.amount > 0 ? "positive" : ""}`;
        return tr;
      }),
  );
  if (!$("transactions").children.length) {
    const tr = document.createElement("tr"),
      td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "No matching activity yet.";
    tr.append(td);
    $("transactions").append(tr);
  }
}
function quote() {
  if (!dashboard) return;
  const value =
    (Number($("convertAmount").value) * dashboard.rates[$("from").value]) /
    dashboard.rates[$("to").value];
  $("quote").textContent =
    `You receive approximately ${money(Math.round(value * 100) || 0, $("to").value)}`;
}
$("loginTab").onclick = () => setMode(false);
$("signupTab").onclick = () => setMode(true);
$("authForm").onsubmit = (event) => {
  event.preventDefault();
  busy($("authSubmit"), async () => {
    await api("/api/auth/" + (signup ? "signup" : "login"), {
      name: $("name").value,
      email: $("email").value,
      password: $("password").value,
    });
    $("password").value = "";
    $("notice").hidden = true;
    await refresh();
  });
};
$("logout").onclick = () =>
  busy($("logout"), async () => {
    await api("/api/auth/logout", {});
    showAuth();
  });
$("refresh").onclick = () => busy($("refresh"), refresh);
for (const id of ["from", "to", "convertAmount"]) $(id).oninput = quote;
$("convertForm").onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    from: $("from").value,
    to: $("to").value,
    amount: $("convertAmount").value,
  };
  const payload = JSON.stringify(data);
  if (form.dataset.payload !== payload) {
    form.dataset.payload = payload;
    form.dataset.key = crypto.randomUUID();
  }
  busy(form.querySelector("button"), async () => {
    await api("/api/convert", data, form.dataset.key);
    delete form.dataset.payload;
    await refresh();
    notice("Exchange complete. Your balances are updated.");
  });
};
$("transferForm").onsubmit = (event) => {
  event.preventDefault();
  const data = {
    email: $("recipient").value,
    currency: $("transferCurrency").value,
    amount: $("transferAmount").value,
  };
  const payload = JSON.stringify(data);
  if (pendingTransfer?.payload !== payload)
    pendingTransfer = { data, payload, key: crypto.randomUUID() };
  $("confirmation").textContent =
    `Send ${money(Math.round(Number(data.amount) * 100), data.currency)} to ${data.email}?`;
  $("confirm").showModal();
};
$("cancelTransfer").onclick = () => $("confirm").close();
$("confirmTransfer").onclick = () =>
  busy($("confirmTransfer"), async () => {
    await api("/api/transfers", pendingTransfer.data, pendingTransfer.key);
    pendingTransfer = null;
    $("confirm").close();
    $("transferForm").reset();
    await refresh();
    notice("Transfer complete.");
  });
$("search").oninput = renderTransactions;
$("export").onclick = () => {
  const cell = (x) =>
    '"' +
    String(x)
      .replace(/"/g, '""')
      .replace(/^[=+@\-]/, "'$&") +
    '"';
  const rows = [
    ["Date", "Details", "Type", "Currency", "Amount"],
    ...dashboard.transactions.map((t) => [
      t.created,
      t.detail,
      t.kind,
      t.currency,
      (t.amount / 100).toFixed(2),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "currencyswap-activity.csv";
  a.click();
  URL.revokeObjectURL(url);
};
$("year").textContent = new Date().getFullYear();
refresh().catch((e) => {
  showAuth();
  if (!/sign in|expired/i.test(e.message)) notice(e.message, true);
});
