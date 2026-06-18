/* UI wiring for the Asset Location Optimizer */

let accounts = [
  { id: 1, name: "Regular brokerage", type: "taxable", balance: 2000000 },
  { id: 2, name: "Company retirement", type: "deferred", balance: 1500000 },
  { id: 3, name: "PERA", type: "free", balance: 500000 },
];
let nextId = 4;

const el = (id) => document.getElementById(id);

/* ---------- Account rows ---------- */
function renderAccounts() {
  const list = el("accountList");
  list.innerHTML = "";
  accounts.forEach((acc) => {
    const row = document.createElement("div");
    row.className = "account-row";
    row.innerHTML = `
      <span class="dot ${ACCOUNT_TYPES[acc.type].className}" title="${ACCOUNT_TYPES[acc.type].label}"></span>
      <input class="acc-name" type="text" value="${escapeAttr(acc.name)}" aria-label="Account name" />
      <select class="acc-type" aria-label="Account type">
        ${Object.entries(ACCOUNT_TYPES)
          .map(
            ([k, v]) =>
              `<option value="${k}" ${k === acc.type ? "selected" : ""}>${v.label}</option>`
          )
          .join("")}
      </select>
      <div class="pct-input money">
        <span class="cur-sym">${currencySymbol()}</span>
        <input class="acc-balance" type="number" min="0" step="1000" value="${acc.balance}" aria-label="Balance" />
      </div>
      <button class="btn btn-remove" type="button" aria-label="Remove account">&times;</button>
    `;
    row.querySelector(".acc-name").addEventListener("input", (e) => {
      acc.name = e.target.value;
    });
    row.querySelector(".acc-type").addEventListener("change", (e) => {
      acc.type = e.target.value;
      row.querySelector(".dot").className = `dot ${ACCOUNT_TYPES[acc.type].className}`;
      recompute();
    });
    row.querySelector(".acc-balance").addEventListener("input", (e) => {
      acc.balance = Math.max(0, parseFloat(e.target.value) || 0);
      recompute();
    });
    row.querySelector(".btn-remove").addEventListener("click", () => {
      accounts = accounts.filter((a) => a.id !== acc.id);
      renderAccounts();
      recompute();
    });
    list.appendChild(row);
  });
}

/* ---------- Recompute & render results ---------- */
function recompute() {
  const bondPct = parseInt(el("bondPct").value, 10) / 100;
  el("bondPctOut").textContent = `${Math.round(bondPct * 100)}%`;
  el("equityPctOut").textContent = `${Math.round((1 - bondPct) * 100)}%`;

  const rates = {
    ordRate: pctVal("ordRate"),
    qualRate: pctVal("qualRate"),
    bondYield: pctVal("bondYield"),
    eqYield: pctVal("eqYield"),
  };

  const plan = optimizeLocation(accounts, bondPct);
  renderWarnings(plan.warnings);
  renderPlan(plan);

  const drag = estimateTaxDrag(plan.accounts, accounts, bondPct, rates);
  renderImpact(drag);
}

function renderWarnings(warnings) {
  const box = el("warnings");
  box.innerHTML = warnings
    .map((w) => `<div class="warning">${w}</div>`)
    .join("");
}

function renderPlan(plan) {
  const box = el("plan");
  if (plan.total <= 0) {
    box.innerHTML = `<p class="empty">Add an account balance to see your placement.</p>`;
    return;
  }

  const cards = plan.accounts
    .map((p) => {
      const bondShare = p.balance ? p.bonds / p.balance : 0;
      const eqShare = p.balance ? p.equities / p.balance : 0;
      return `
        <div class="acct-plan">
          <div class="acct-plan-head">
            <span class="dot ${ACCOUNT_TYPES[p.type].className}"></span>
            <strong>${escapeHtml(p.name)}</strong>
            <span class="acct-total">${fmtMoney(p.balance)}</span>
          </div>
          <div class="bar">
            <div class="bar-bond" style="width:${bondShare * 100}%" title="Bonds"></div>
            <div class="bar-eq" style="width:${eqShare * 100}%" title="Equities"></div>
          </div>
          <div class="acct-plan-legend">
            ${p.bonds > 0 ? `<span><i class="sw bond"></i>${fmtMoney(p.bonds)} bonds</span>` : ""}
            ${p.equities > 0 ? `<span><i class="sw eq"></i>${fmtMoney(p.equities)} equities</span>` : ""}
          </div>
        </div>`;
    })
    .join("");

  box.innerHTML = `
    <div class="plan-summary">
      <div><span class="big">${fmtMoney(plan.totals.bonds)}</span><label>Bonds total</label></div>
      <div><span class="big">${fmtMoney(plan.totals.equities)}</span><label>Equities total</label></div>
      <div><span class="big">${fmtMoney(plan.total)}</span><label>Portfolio</label></div>
    </div>
    <div class="acct-plans">${cards}</div>`;
}

function renderImpact(drag) {
  const box = el("impact");
  const positive = drag.savings > 0.5;
  box.innerHTML = `
    <div class="impact-grid">
      <div class="impact-cell">
        <label>Naive (same mix everywhere)</label>
        <span class="num bad">${fmtMoney(drag.naive)}/yr</span>
      </div>
      <div class="impact-cell">
        <label>Optimized placement</label>
        <span class="num good">${fmtMoney(drag.optimized)}/yr</span>
      </div>
      <div class="impact-cell highlight">
        <label>Estimated annual tax saved</label>
        <span class="num save">${fmtMoney(Math.max(0, drag.savings))}/yr</span>
      </div>
    </div>
    ${
      positive
        ? `<p class="impact-note">By relocating bonds into tax-sheltered accounts you cut the
           current tax on investment income by about
           <strong>${fmtMoney(drag.savings)}</strong> per year — compounding over time —
           with no change to your overall risk.</p>`
        : `<p class="impact-note">No taxable-account drag to optimize here (no bonds land in a
           taxable account under this plan).</p>`
    }`;
}

/* ---------- helpers ---------- */
function pctVal(id) {
  return Math.max(0, parseFloat(el(id).value) || 0) / 100;
}
function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return s.replace(/"/g, "&quot;");
}

/* ---------- events ---------- */
el("addAccount").addEventListener("click", () => {
  accounts.push({ id: nextId++, name: "New account", type: "taxable", balance: 0 });
  renderAccounts();
});
["bondPct", "ordRate", "qualRate", "bondYield", "eqYield"].forEach((id) =>
  el(id).addEventListener("input", recompute)
);

// Currency: update the symbol on every money field and re-render all amounts.
el("currency").addEventListener("change", (e) => {
  setCurrency(e.target.value);
  document
    .querySelectorAll(".cur-sym")
    .forEach((s) => (s.textContent = currencySymbol()));
  recompute();
});

/* ---------- init ---------- */
renderAccounts();
recompute();
