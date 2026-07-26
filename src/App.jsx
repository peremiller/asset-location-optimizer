import { useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CaretDown,
  CheckCircle,
  Info,
  Plus,
  X,
} from "@phosphor-icons/react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import phFlag from "flag-icons/flags/4x3/ph.svg";

const INITIAL_ACCOUNTS = [
  { id: 1, name: "BPI / BDO + PSE stocks", type: "taxable", balance: 2_000_000 },
  { id: 2, name: "Equity / Bond UITF", type: "fund", balance: 1_500_000 },
  { id: 3, name: "PERA", type: "pera", balance: 500_000 },
];

const ACCOUNT_TYPES = {
  taxable: {
    label: "Bank / Direct (taxable)",
    short: "Bank / Direct (taxable)",
    color: "var(--blue)",
    description:
      "Deposits, RTBs and direct PSE stocks: 20% tax on interest, 10% on dividends, 0% on listed-share gains.",
  },
  fund: {
    label: "Mutual Fund / UITF",
    short: "Mutual Fund / UITF",
    color: "var(--purple)",
    description: "Gains are tax-exempt on redemption, offering a flexible shelter with no annual cap.",
  },
  pera: {
    label: "PERA (tax-exempt)",
    short: "PERA (tax-exempt)",
    color: "var(--green)",
    description: "Investment income is fully tax-exempt; best used as a bond shelter (subject to contribution caps).",
  },
};

const CURRENCIES = {
  PHP: { symbol: "₱", locale: "en-PH" },
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" },
  SGD: { symbol: "S$", locale: "en-SG" },
  JPY: { symbol: "¥", locale: "ja-JP" },
};

const BOND_PRIORITY = { pera: 0, fund: 1, taxable: 2 };

function formatMoney(value, currency) {
  const { symbol, locale } = CURRENCIES[currency];
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${symbol}${Math.round(safeValue).toLocaleString(locale)}`;
}

function optimizeAccounts(accounts, targetBondPercent) {
  const total = accounts.reduce((sum, account) => sum + Math.max(0, Number(account.balance) || 0), 0);
  let remainingBonds = total * (targetBondPercent / 100);
  const result = new Map();

  [...accounts]
    .sort((a, b) => BOND_PRIORITY[a.type] - BOND_PRIORITY[b.type])
    .forEach((account) => {
      const balance = Math.max(0, Number(account.balance) || 0);
      const bonds = Math.min(balance, Math.max(0, remainingBonds));
      result.set(account.id, { bonds, equities: balance - bonds });
      remainingBonds -= bonds;
    });

  return { total, result };
}

function calculateTaxDrag(accounts, allocations, targetBondPercent, rates) {
  const bondRate = rates.bondYield / 100;
  const equityRate = rates.equityYield / 100;
  const interestRate = rates.interestTax / 100;
  const dividendRate = rates.dividendTax / 100;
  let naive = 0;
  let optimized = 0;

  accounts.forEach((account) => {
    if (account.type !== "taxable") return;
    const balance = Math.max(0, Number(account.balance) || 0);
    const naiveBonds = balance * (targetBondPercent / 100);
    const naiveEquities = balance - naiveBonds;
    const placement = allocations.get(account.id) || { bonds: 0, equities: 0 };
    naive += naiveBonds * bondRate * interestRate + naiveEquities * equityRate * dividendRate;
    optimized += placement.bonds * bondRate * interestRate + placement.equities * equityRate * dividendRate;
  });

  return { naive, optimized, saved: Math.max(0, naive - optimized) };
}

function Step({ number, label, active, onClick }) {
  return (
    <button className={`step ${active ? "is-active" : ""}`} type="button" onClick={onClick}>
      <span className="step-number">{number}</span>
      <span>{label}</span>
    </button>
  );
}

function AccountEditor({ account, currency, onChange, onRemove, canRemove }) {
  const type = ACCOUNT_TYPES[account.type];
  return (
    <article className="account-editor" style={{ "--account-color": type.color }}>
      <div className="account-editor__top">
        <span className="account-dot" aria-hidden="true" />
        <input
          className="account-name-input"
          aria-label="Account name"
          value={account.name}
          onChange={(event) => onChange(account.id, "name", event.target.value)}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`Remove ${account.name}`}
          onClick={() => onRemove(account.id)}
          disabled={!canRemove}
        >
          <X size={16} weight="bold" />
        </button>
      </div>
      <select
        className="account-type-select"
        aria-label={`Account type for ${account.name}`}
        value={account.type}
        onChange={(event) => onChange(account.id, "type", event.target.value)}
      >
        {Object.entries(ACCOUNT_TYPES).map(([value, item]) => (
          <option key={value} value={value}>{item.label}</option>
        ))}
      </select>
      <label className="money-input">
        <span>{CURRENCIES[currency].symbol}</span>
        <input
          aria-label={`Balance for ${account.name}`}
          type="text"
          inputMode="numeric"
          value={Number(account.balance || 0).toLocaleString(CURRENCIES[currency].locale)}
          onChange={(event) => onChange(account.id, "balance", Number(event.target.value.replace(/[^0-9.]/g, "")) || 0)}
        />
      </label>
    </article>
  );
}

function PlacementRow({ account, placement, total, currency }) {
  const type = ACCOUNT_TYPES[account.type];
  const bondsPercent = account.balance ? Math.round((placement.bonds / account.balance) * 100) : 0;
  const equitiesPercent = 100 - bondsPercent;
  const destinationTitle =
    placement.bonds > 0 && placement.equities > 0
      ? "Bonds + Equities"
      : placement.bonds > 0
        ? "Bonds"
        : "Equities";
  const destinationText =
    account.type === "pera"
      ? "PERA is the strongest shelter for bond investment income."
      : account.type === "fund"
        ? "Shelter bonds here while retaining equity flexibility."
        : "Direct PSE equities avoid tax on listed-share gains.";

  return (
    <div className="placement-row" style={{ "--account-color": type.color }}>
      <div className="placement-account">
        <span className="account-dot" aria-hidden="true" />
        <div>
          <strong>{account.name}</strong>
          <span>{type.short}</span>
          <b>{formatMoney(account.balance, currency)}</b>
        </div>
      </div>
      <ArrowRight className="flow-arrow" size={24} aria-hidden="true" />
      <div className="placement-assets">
        {placement.bonds > 0 && (
          <div className="asset-block asset-block--bonds">
            <span>Bonds</span><strong>{formatMoney(placement.bonds, currency)}</strong><small>{bondsPercent}%</small>
          </div>
        )}
        {placement.equities > 0 && (
          <div className="asset-block asset-block--equities">
            <span>Equities</span><strong>{formatMoney(placement.equities, currency)}</strong><small>{equitiesPercent}%</small>
          </div>
        )}
      </div>
      <ArrowRight className="flow-arrow" size={24} aria-hidden="true" />
      <div className={`destination ${placement.bonds > 0 ? "destination--bonds" : "destination--equities"}`}>
        <strong>{destinationTitle}</strong><span>{destinationText}</span>
      </div>
      <div className="mobile-allocation-bar" aria-label={`${account.name} allocation`}>
        {placement.bonds > 0 && <span className="mobile-allocation-bar__bonds" style={{ width: `${(placement.bonds / total) * 100}%` }} />}
        {placement.equities > 0 && <span className="mobile-allocation-bar__equities" style={{ width: `${(placement.equities / total) * 100}%` }} />}
      </div>
    </div>
  );
}

export function App() {
  const [accounts, setAccounts] = useState(INITIAL_ACCOUNTS);
  const [currency, setCurrency] = useState("PHP");
  const [targetBonds, setTargetBonds] = useState(40);
  const [interestTax, setInterestTax] = useState(20);
  const [dividendTax, setDividendTax] = useState(10);
  const [bondYield, setBondYield] = useState(6);
  const [equityYield, setEquityYield] = useState(2);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);
  const accountsRef = useRef(null);
  const workspaceRef = useRef(null);
  const controlsRef = useRef(null);

  const { total, result: allocations } = useMemo(() => optimizeAccounts(accounts, targetBonds), [accounts, targetBonds]);
  const bondsTotal = total * (targetBonds / 100);
  const equitiesTotal = total - bondsTotal;
  const taxDrag = useMemo(
    () => calculateTaxDrag(accounts, allocations, targetBonds, { interestTax, dividendTax, bondYield, equityYield }),
    [accounts, allocations, targetBonds, interestTax, dividendTax, bondYield, equityYield],
  );

  function updateAccount(id, field, value) {
    setAccounts((current) => current.map((account) => (account.id === id ? { ...account, [field]: value } : account)));
    setIsOptimized(false);
  }

  function addAccount() {
    setAccounts((current) => [...current, { id: Date.now(), name: "New account", type: "taxable", balance: 0 }]);
    setIsOptimized(false);
  }

  function removeAccount(id) {
    setAccounts((current) => current.filter((account) => account.id !== id));
    setIsOptimized(false);
  }

  function resetInputs() {
    setAccounts(INITIAL_ACCOUNTS);
    setCurrency("PHP");
    setTargetBonds(40);
    setInterestTax(20);
    setDividendTax(10);
    setBondYield(6);
    setEquityYield(2);
    setAssumptionsOpen(false);
    setIsOptimized(false);
  }

  function runOptimization() {
    if (isCalculating) return;
    setIsCalculating(true);
    window.setTimeout(() => {
      setIsCalculating(false);
      setIsOptimized(true);
      workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 650);
  }

  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <h1>Asset Location Optimizer</h1>
          <span className="edition-badge"><img src={phFlag} alt="" aria-hidden="true" /> PH edition</span>
        </div>
        <nav className="progress-nav" aria-label="Optimizer steps">
          <Step number="1" label="Accounts" active={!isOptimized} onClick={() => scrollTo(accountsRef)} />
          <span className="step-line" aria-hidden="true" />
          <Step number="2" label="Optimize" active={isCalculating} onClick={() => scrollTo(controlsRef)} />
          <span className="step-line" aria-hidden="true" />
          <Step number="3" label="Review" active={isOptimized} onClick={() => scrollTo(workspaceRef)} />
        </nav>
        <label className="currency-control">
          <span>Currency</span>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} aria-label="Currency">
            {Object.keys(CURRENCIES).map((code) => <option key={code} value={code}>{CURRENCIES[code].symbol} {code}</option>)}
          </select>
        </label>
      </header>

      <main className="app-grid">
        <aside className="accounts-panel" ref={accountsRef}>
          <div className="section-heading-row">
            <div><span className="eyebrow">1. Your accounts</span><p>Enter each balance. The account type determines how its earnings are taxed.</p></div>
            <Info size={18} aria-label="Account guidance" />
          </div>
          <button className="secondary-button add-account-button" type="button" onClick={addAccount}><Plus size={18} weight="bold" /> Add account</button>
          <div className="account-editors">
            {accounts.map((account) => (
              <AccountEditor key={account.id} account={account} currency={currency} onChange={updateAccount} onRemove={removeAccount} canRemove={accounts.length > 1} />
            ))}
          </div>
          <div className="account-notes">
            {Object.entries(ACCOUNT_TYPES).map(([key, type]) => (
              <div className="note-row" key={key}>
                <span className="note-dot" style={{ backgroundColor: type.color }} aria-hidden="true" />
                <p><strong>{type.label}</strong> — {type.description}</p>
              </div>
            ))}
          </div>
        </aside>

        <section className="workspace" ref={workspaceRef}>
          <div className="outcome-hero">
            <h2>You could save an estimated <strong>{formatMoney(taxDrag.saved, currency)}</strong> per year</h2>
            <p>Place bonds in tax-sheltered accounts and equities where they are most efficient—without changing your overall risk.</p>
          </div>
          {isOptimized && <div className="success-banner" role="status"><CheckCircle size={20} weight="fill" /> Placement updated using your latest balances and tax assumptions.</div>}

          <section className="placement-card" aria-labelledby="placement-title">
            <div className="placement-card__header">
              <div><span className="eyebrow">Recommended placement map</span><h3 id="placement-title">Keep your risk mix. Improve where each asset lives.</h3></div>
              <span className="portfolio-total">{formatMoney(total, currency)} portfolio</span>
            </div>
            <div className="placement-column-labels" aria-hidden="true"><span>Your accounts</span><span /><span>Place these assets</span><span /><span>Into these destinations</span></div>
            <div className="placement-rows">
              {accounts.map((account) => <PlacementRow key={account.id} account={account} placement={allocations.get(account.id) || { bonds: 0, equities: 0 }} total={total || 1} currency={currency} />)}
            </div>
            <div className="legend-row"><span><i className="legend-swatch legend-swatch--bonds" /> Bonds (tax-friendly)</span><span><i className="legend-swatch legend-swatch--equities" /> Equities (growth-focused)</span></div>
            <div className="allocation-totals">
              <div><strong>{formatMoney(bondsTotal, currency)}</strong><span>Bonds total</span></div>
              <div><strong>{formatMoney(equitiesTotal, currency)}</strong><span>Equities total</span></div>
              <div><strong>{formatMoney(total, currency)}</strong><span>Portfolio</span></div>
            </div>
          </section>

          <section className="tax-impact" aria-labelledby="tax-impact-title">
            <div className="tax-impact__header">
              <div><span className="eyebrow">Estimated annual tax drag</span><h3 id="tax-impact-title">See the impact of smarter placement</h3></div>
              <span className="estimate-chip">Educational estimate</span>
            </div>
            <div className="tax-comparison">
              <div className="tax-number tax-number--naive"><span>Naïve mix everywhere</span><strong>{formatMoney(taxDrag.naive, currency)}<small>/year</small></strong></div>
              <ArrowRight size={24} aria-hidden="true" />
              <div className="tax-number"><span>Optimized placement</span><strong>{formatMoney(taxDrag.optimized, currency)}<small>/year</small></strong></div>
              <ArrowRight size={24} aria-hidden="true" />
              <div className="tax-number tax-number--saved"><span>Estimated annual tax saved</span><strong>{formatMoney(taxDrag.saved, currency)}<small>/year</small></strong></div>
            </div>
            <p className="impact-summary">Relocating bonds into tax-sheltered accounts could reduce current tax on investment income by about <strong>{formatMoney(taxDrag.saved, currency)}</strong> per year—compounding over time with no change to your overall risk.</p>
          </section>

          <p className="disclaimer"><Info size={16} aria-hidden="true" /><span><strong>Educational estimate only.</strong> A single-year, steady-state approximation using PH final-withholding-tax rates. It excludes the 0.6% stock transaction tax, PERA contribution limits and tax credit, estate tax, fees, and your personal circumstances. Not tax advice—confirm with a Philippine tax professional or the BIR.</span></p>
        </section>

        <aside className="controls-panel" ref={controlsRef}>
          <div className="section-heading-row"><span className="eyebrow">2. Target allocation</span><Info size={18} aria-label="Allocation guidance" /></div>
          <div className="range-group">
            <div className="label-row"><label htmlFor="target-bonds">Target bonds</label><strong>{targetBonds}%</strong></div>
            <input id="target-bonds" type="range" min="0" max="100" value={targetBonds} style={{ "--range-progress": `${targetBonds}%` }} onChange={(event) => { setTargetBonds(Number(event.target.value)); setIsOptimized(false); }} />
            <div className="range-scale"><span>0%</span><span>100%</span></div>
            <p>Equities take the remaining {100 - targetBonds}%.</p>
          </div>
          <div className="control-divider" />
          <div className="section-heading-row tax-heading"><span className="eyebrow">Tax profile (PH)</span><Info size={18} aria-label="Philippine tax profile guidance" /></div>
          <label className="percent-control"><span>Interest tax (final withholding)</span><div><input type="number" min="0" max="60" value={interestTax} onChange={(event) => setInterestTax(Number(event.target.value))} /><b>%</b></div><small>20% final tax on peso bond and deposit interest in a taxable account.</small></label>
          <label className="percent-control"><span>Dividend tax (final)</span><div><input type="number" min="0" max="40" value={dividendTax} onChange={(event) => setDividendTax(Number(event.target.value))} /><b>%</b></div><small>10% final tax on cash dividends from domestic companies.</small></label>
          <button className="assumptions-toggle" type="button" aria-expanded={assumptionsOpen} onClick={() => setAssumptionsOpen((open) => !open)}><CaretDown size={16} className={assumptionsOpen ? "is-open" : ""} /> Return &amp; yield assumptions</button>
          {assumptionsOpen && (
            <div className="assumptions-panel">
              <label>Bond / fixed-income yield<div><input type="number" min="0" max="20" step="0.1" value={bondYield} onChange={(event) => setBondYield(Number(event.target.value))} /><b>%</b></div></label>
              <label>Equity dividend yield<div><input type="number" min="0" max="10" step="0.1" value={equityYield} onChange={(event) => setEquityYield(Number(event.target.value))} /><b>%</b></div></label>
            </div>
          )}
          <div className="controls-actions">
            <button className="primary-button" type="button" onClick={runOptimization} disabled={isCalculating || total === 0}>
              {isCalculating ? <span className="button-spinner" aria-hidden="true" /> : <CheckCircle size={20} weight="bold" />}{isCalculating ? "Optimizing…" : "Optimize placement"}
            </button>
            <button className="secondary-button reset-button" type="button" onClick={resetInputs}><ArrowCounterClockwise size={18} /> Reset inputs</button>
          </div>
        </aside>
      </main>
    </div>
  );
}
