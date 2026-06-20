/*
 * Asset Location Optimizer — Philippine edition — core logic
 *
 * Your overall stock/bond ratio is fixed by your risk tolerance. Asset
 * *location* decides WHICH wrapper each peso of stocks vs bonds sits in.
 *
 * Philippine tax reality (individual investor):
 *   • Interest on peso deposits / bonds  → 20% FINAL withholding tax (heavy).
 *   • Cash dividends from PH companies    → 10% final tax.
 *   • Gains on PSE-listed shares          → NO capital gains tax; only a 0.6%
 *                                           stock-transaction tax when you sell.
 *   • PERA, mutual funds & UITFs          → investment income is tax-EXEMPT.
 *
 * So in the PH the costly asset is FIXED INCOME (that 20% interest tax), while
 * stocks are already tax-light. The efficient default is therefore:
 *
 *   1. Fill your TAX-EXEMPT shelters (PERA, then mutual funds / UITFs) with
 *      BONDS first — that's where the 20% interest tax is killed.
 *   2. Overflow bonds into the TAXABLE bucket (bank / direct bonds) only if the
 *      shelters run out — and prefer a 5-year+ time deposit there (exempt).
 *   3. Hold EQUITIES in the taxable bucket (direct PSE stocks barely get taxed),
 *      preserving scarce shelter space for bonds.
 *
 * Same total bond %, but bonds end up where their interest isn't taxed.
 */

const ACCOUNT_TYPES = {
  pera: { label: "PERA (tax-exempt)", className: "pera" },
  fund: { label: "Mutual Fund / UITF", className: "fund" },
  taxable: { label: "Bank / Direct (taxable)", className: "taxable" },
};

// Bonds go to the best shelter first: PERA → Mutual Fund/UITF → taxable.
const BOND_PRIORITY = ["pera", "fund", "taxable"];
// Equities take whatever's left, staying in the lightly-taxed taxable bucket
// so the tax-exempt shelters are reserved for bonds.
const EQUITY_PRIORITY = ["taxable", "fund", "pera"];

/**
 * Compute the optimal asset location.
 *
 * @param {Array<{id, name, type, balance}>} accounts
 * @param {number} bondPct  target bond fraction of whole portfolio (0..1)
 * @returns {{accounts, totals, total, bondTarget, equityTarget, warnings}}
 */
function optimizeLocation(accounts, bondPct) {
  const valid = accounts.filter((a) => a.balance > 0);
  const total = valid.reduce((s, a) => s + a.balance, 0);

  const result = {
    accounts: [],
    total,
    bondTarget: total * bondPct,
    equityTarget: total * (1 - bondPct),
    warnings: [],
  };
  if (total <= 0) return result;

  // Remaining capacity (free space) in each account, and what we've placed.
  const placed = valid.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: a.balance,
    free: a.balance, // unallocated room
    bonds: 0,
    equities: 0,
  }));
  const byId = Object.fromEntries(placed.map((p) => [p.id, p]));

  let bondsLeft = result.bondTarget;
  let equitiesLeft = result.equityTarget;

  // --- Phase 1: place bonds by priority ---
  for (const type of BOND_PRIORITY) {
    if (bondsLeft <= 1e-9) break;
    for (const p of placed.filter((p) => p.type === type)) {
      if (bondsLeft <= 1e-9) break;
      const put = Math.min(p.free, bondsLeft);
      p.bonds += put;
      p.free -= put;
      bondsLeft -= put;
    }
  }

  // --- Phase 2: fill remaining space with equities by priority ---
  for (const type of EQUITY_PRIORITY) {
    if (equitiesLeft <= 1e-9) break;
    for (const p of placed.filter((p) => p.type === type)) {
      if (equitiesLeft <= 1e-9) break;
      const put = Math.min(p.free, equitiesLeft);
      p.equities += put;
      p.free -= put;
      equitiesLeft -= put;
    }
  }

  // --- Diagnostics ---
  // Shelter space = everything that isn't the plain taxable bucket
  // (PERA + Mutual Funds / UITFs all make investment income tax-exempt).
  const shelterSpace = placed
    .filter((p) => p.type !== "taxable")
    .reduce((s, p) => s + p.balance, 0);
  if (result.bondTarget > shelterSpace + 1e-6) {
    const overflow = result.bondTarget - shelterSpace;
    result.warnings.push(
      `Your bond target (${fmtMoney(result.bondTarget)}) is bigger than your ` +
        `tax-exempt shelter space (${fmtMoney(shelterSpace)} in PERA + funds). ` +
        `${fmtMoney(overflow)} of bonds had to stay in the taxable bucket, where ` +
        `interest is hit with the 20% final tax — park that slice in a 5-year+ ` +
        `time deposit or a bond UITF, whose interest is tax-exempt.`
    );
  }
  if (shelterSpace > result.bondTarget + 1e-6 && result.equityTarget > 0) {
    result.warnings.push(
      `You have more tax-exempt shelter than you have bonds, so the surplus ` +
        `holds equities. That's fine — your fixed income is fully sheltered.`
    );
  }

  result.accounts = placed;
  result.totals = {
    bonds: placed.reduce((s, p) => s + p.bonds, 0),
    equities: placed.reduce((s, p) => s + p.equities, 0),
  };
  return result;
}

/**
 * Estimate annual taxes for a given placement vs a naive "same mix in every
 * account" baseline. Only the taxable-account holdings generate current tax.
 *
 * @returns {{optimized:number, naive:number, savings:number}}
 */
function estimateTaxDrag(placed, accounts, bondPct, rates) {
  const { ordRate, qualRate, bondYield, eqYield } = rates;

  // Tax generated by the taxable account(s) under a given bond/equity split.
  const taxableTax = (bondDollars, equityDollars) =>
    bondDollars * bondYield * ordRate + // bond interest @ ordinary rate
    equityDollars * eqYield * qualRate; // dividends @ qualified rate

  // Optimized: use actual placement in taxable accounts.
  let optimized = 0;
  for (const p of placed.filter((a) => a.type === "taxable")) {
    optimized += taxableTax(p.bonds, p.equities);
  }

  // Naive baseline: every account (incl. taxable) holds the target mix.
  let naive = 0;
  for (const a of accounts.filter((a) => a.type === "taxable" && a.balance > 0)) {
    naive += taxableTax(a.balance * bondPct, a.balance * (1 - bondPct));
  }

  return { optimized, naive, savings: naive - optimized };
}

/* ---------- Currency ---------- */
// The app is built for a Philippine setting, so PHP is the default.
const CURRENCIES = {
  PHP: { code: "PHP", symbol: "₱", locale: "en-PH", label: "Philippine Peso" },
  USD: { code: "USD", symbol: "$", locale: "en-US", label: "US Dollar" },
  EUR: { code: "EUR", symbol: "€", locale: "de-DE", label: "Euro" },
  SGD: { code: "SGD", symbol: "S$", locale: "en-SG", label: "Singapore Dollar" },
  JPY: { code: "JPY", symbol: "¥", locale: "ja-JP", label: "Japanese Yen" },
};

let CURRENT_CURRENCY = "PHP";

function setCurrency(code) {
  if (CURRENCIES[code]) CURRENT_CURRENCY = code;
}
function currencySymbol() {
  return CURRENCIES[CURRENT_CURRENCY].symbol;
}

function fmtMoney(n) {
  const c = CURRENCIES[CURRENT_CURRENCY];
  return n.toLocaleString(c.locale, {
    style: "currency",
    currency: c.code,
    maximumFractionDigits: 0,
  });
}

function fmtPct(n) {
  return (n * 100).toFixed(0) + "%";
}

if (typeof module !== "undefined") {
  module.exports = {
    optimizeLocation,
    estimateTaxDrag,
    ACCOUNT_TYPES,
    CURRENCIES,
    setCurrency,
  };
}
