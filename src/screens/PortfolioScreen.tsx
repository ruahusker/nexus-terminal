"use client";

// PORTFOLIO — manual portfolio tracking & analytics. Research only: records
// transactions, never routes orders. Live marks refresh every 20s.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTerminal } from "@/components/TerminalContext";
import { EmptyState, ErrorState, Loading, SampleBanner, SectionTitle, Sparkline, useApi } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import { dirClass, dirGlyph, fmtCompact, fmtDateTime, fmtNum, fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import type { Bar, Fundamentals, Quote, ScreenerRow } from "@/lib/types";
import {
  allocation, buildEquityCurve, concentration, CSV_TEMPLATE, daysUntil, incomeTotals,
  positionRows, riskStats, scenarioImpact, summarize, SYMBOL_RE,
  type CalEvent, type Portfolio, type PositionRow, type ScenarioKind,
} from "./portfolioUtils";

type TabId = "POSITIONS" | "ANALYTICS" | "TRANSACTIONS" | "CALENDAR" | "SCENARIOS";
const TABS: TabId[] = ["POSITIONS", "ANALYTICS", "TRANSACTIONS", "CALENDAR", "SCENARIOS"];
const TXN_SIDES = ["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"] as const;

const money = (n: number | null | undefined) => (n == null ? "—" : `$${fmtPrice(n, "")}`);
const signedMoney = (n: number | null | undefined) => (n == null ? "—" : `$${fmtSigned(n)}`);

const inputCls = "bg-nx-inset px-1.5 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none";
const btnCls = "border border-nx-border px-2 py-0.5 text-[10px] text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40";

export default function PortfolioScreen(_props: { symbol?: string }) {
  const { data, error, loading, retry } = useApi<Portfolio[]>("/api/portfolios");
  const { open } = useTerminal();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("POSITIONS");
  const [mutErr, setMutErr] = useState<string | null>(null);

  const portfolios = data ?? [];
  const active = portfolios.find((p) => p.id === activeId) ?? portfolios[0];

  // ── Live marks (20s refresh) ────────────────────────────────────────────
  const symbols = useMemo(
    () => Array.from(new Set((active?.positions ?? []).map((p) => p.symbol))).sort(),
    [active],
  );
  const symKey = symbols.join(",");
  const quotesPath = symKey ? `/api/quote?symbols=${encodeURIComponent(symKey)}` : null;
  const { data: quoteData } = useApi<Quote[]>(quotesPath, 20_000);
  const marks = useMemo(() => new Map((quoteData ?? []).map((q) => [q.symbol, q])), [quoteData]);

  // ── Screener map (sector + beta), fetched once ──────────────────────────
  const { data: screener } = useApi<ScreenerRow[]>("/api/screener");
  const infoMap = useMemo(() => {
    const m = new Map<string, { sector: string | null; beta: number | null }>();
    for (const r of screener ?? []) m.set(r.symbol, { sector: r.sector ?? null, beta: r.beta ?? null });
    return m;
  }, [screener]);

  // ── Derived rows / summary ──────────────────────────────────────────────
  const rows = useMemo(() => positionRows(active?.positions ?? [], marks), [active, marks]);
  const summary = useMemo(() => summarize(rows, active?.cash ?? 0), [rows, active]);

  // ── Equity curve inputs: top-10 non-option symbols by value ─────────────
  const curveSyms = useMemo(() => {
    const ps = (active?.positions ?? []).filter((p) => p.assetClass !== "OPTION");
    return ps
      .sort((a, b) => b.quantity * b.avgCost - a.quantity * a.avgCost)
      .map((p) => p.symbol)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, 10);
  }, [active]);
  const curveKey = curveSyms.join(",");

  const [barsMap, setBarsMap] = useState<Map<string, number[]>>(new Map());
  const [barsLoading, setBarsLoading] = useState(false);
  useEffect(() => {
    if (tab !== "ANALYTICS" || !curveKey) return;
    let cancelled = false;
    setBarsLoading(true);
    const syms = curveKey.split(",");
    void Promise.all(
      syms.map((s) =>
        api<{ bars: Bar[] }>(`/api/bars?symbol=${encodeURIComponent(s)}&interval=1d&range=6M`).then((r) => r.bars).catch(() => [] as Bar[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const m = new Map<string, number[]>();
      results.forEach((bars, i) => {
        m.set(syms[i] as string, [...bars].sort((a, b) => a.time - b.time).map((b) => b.close));
      });
      setBarsMap(m);
      setBarsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, curveKey]);

  const equityValueBySym = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.position.assetClass === "OPTION") continue;
      m.set(r.position.symbol, (m.get(r.position.symbol) ?? 0) + r.mktValue);
    }
    return m;
  }, [rows]);

  const curve = useMemo(() => {
    const series = curveSyms.map((s) => ({
      weight: equityValueBySym.get(s) ?? 0,
      closes: barsMap.get(s) ?? [],
    }));
    return buildEquityCurve(series, 120);
  }, [curveSyms, equityValueBySym, barsMap]);
  const risk = useMemo(() => riskStats(curve), [curve]);

  const analytics = useMemo(() => {
    const betaOf = (sym: string) => infoMap.get(sym)?.beta ?? null;
    let betaNum = 0;
    let betaDen = 0;
    for (const r of rows) {
      const b = betaOf(r.position.symbol);
      if (b != null && r.mktValue > 0) {
        betaNum += b * r.mktValue;
        betaDen += r.mktValue;
      }
    }
    return {
      byClass: allocation(rows, (p) => p.assetClass),
      bySector: allocation(rows, (p) => infoMap.get(p.symbol)?.sector ?? "Unknown / not in demo universe"),
      conc: concentration(rows),
      beta: betaDen > 0 ? betaNum / betaDen : null,
      income: incomeTotals(active?.transactions ?? []),
    };
  }, [rows, infoMap, active]);

  // ── Fundamentals for earnings calendar (cap 8 symbols) ──────────────────
  const calSymsKey = symbols.slice(0, 8).join(",");
  const [fundMap, setFundMap] = useState<Map<string, Fundamentals>>(new Map());
  useEffect(() => {
    if (tab !== "CALENDAR" || !calSymsKey) return;
    let cancelled = false;
    const syms = calSymsKey.split(",");
    void Promise.all(
      syms.map((s) => api<Fundamentals>(`/api/fundamentals?symbol=${encodeURIComponent(s)}`).catch(() => null)),
    ).then((results) => {
      if (cancelled) return;
      const m = new Map<string, Fundamentals>();
      results.forEach((f, i) => {
        if (f) m.set(syms[i] as string, f);
      });
      setFundMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, calSymsKey]);

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const p of active?.positions ?? []) {
      if (p.assetClass === "OPTION" && p.expiry) {
        const d = daysUntil(p.expiry);
        if (d >= 0) {
          out.push({
            date: p.expiry,
            days: d,
            kind: "OPTION_EXPIRY",
            label: `${p.symbol} ${p.optionType ?? ""} ${p.strike != null ? `$${fmtPrice(p.strike, "")}` : ""} expires`,
          });
        }
      }
    }
    for (const [sym, f] of fundMap) {
      const future = f.earningsCalendar
        .filter((e) => daysUntil(e.date) >= 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const next = future[0];
      if (next) out.push({ date: next.date, days: daysUntil(next.date), kind: "EARNINGS", label: `${sym} earnings` });
    }
    return out.sort((a, b) => a.days - b.days);
  }, [active, fundMap]);

  // ── Portfolio mutations ─────────────────────────────────────────────────
  const createPortfolio = async () => {
    const name = window.prompt("New portfolio name:");
    if (!name?.trim()) return;
    const cashRaw = window.prompt("Opening cash (USD):", "0");
    if (cashRaw == null) return;
    const cash = Number(cashRaw);
    if (!Number.isFinite(cash) || cash < 0) {
      setMutErr("Opening cash must be a non-negative number");
      return;
    }
    try {
      const p = await api<Portfolio>("/api/portfolios", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), cash }),
      });
      setActiveId(p.id);
      setMutErr(null);
      retry();
    } catch (e) {
      setMutErr(e instanceof Error ? e.message : "Create failed");
    }
  };

  const renamePortfolio = async () => {
    if (!active) return;
    const name = window.prompt("Rename portfolio:", active.name);
    if (!name?.trim() || name.trim() === active.name) return;
    try {
      await api(`/api/portfolios/${active.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
      setMutErr(null);
      retry();
    } catch (e) {
      setMutErr(e instanceof Error ? e.message : "Rename failed");
    }
  };

  const deletePortfolio = async () => {
    if (!active || portfolios.length <= 1) return;
    if (!window.confirm(`Delete portfolio "${active.name}"? All positions and transactions will be removed.`)) return;
    try {
      await api(`/api/portfolios/${active.id}`, { method: "DELETE" });
      setActiveId(null);
      setMutErr(null);
      retry();
    } catch (e) {
      setMutErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && !data) return <Loading label="Loading portfolios" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  const hasOptions = rows.some((r) => r.position.assetClass === "OPTION");

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Portfolio analytics">
{(quoteData ?? []).some((q) => q.status === "SAMPLE") && <SampleBanner />}

      {/* Portfolio selector */}
      <div className="flex items-center gap-1 border-b border-nx-border-strong bg-nx-panel-2 px-1 py-0.5" role="tablist" aria-label="Portfolio selector">
        {portfolios.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={active?.id === p.id}
            onClick={() => setActiveId(p.id)}
            className={`px-2 py-0.5 text-[11px] ${active?.id === p.id ? "bg-nx-panel text-nx-amber" : "text-nx-muted hover:text-nx-text"}`}
          >
            {p.name}
          </button>
        ))}
        <button onClick={() => void createPortfolio()} className="px-2 text-[11px] text-nx-cyan hover:text-nx-text" aria-label="Create portfolio">
          ＋ New
        </button>
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <button onClick={() => void renamePortfolio()} disabled={!active} className={btnCls}>Rename</button>
        <button
          onClick={() => void deletePortfolio()}
          disabled={!active || portfolios.length <= 1}
          title={portfolios.length <= 1 ? "At least one portfolio must exist" : "Delete this portfolio"}
          className={`${btnCls} text-nx-down`}
        >
          Delete
        </button>
        {mutErr && <span className="px-2 text-[10px] text-nx-down" role="alert">⚠ {mutErr}</span>}
      </div>

      {!active ? (
        <EmptyState message="No portfolios" hint="Create one with ＋ New above" />
      ) : (
        <>
          {/* Summary header */}
          <div className="grid grid-cols-2 gap-px border-b border-nx-border bg-nx-border sm:grid-cols-5" aria-label="Portfolio summary">
            <Stat label="Total Value" value={money(summary.total)} title={`Invested ${money(summary.invested)} + cash ${money(summary.cash)}`} />
            <Stat label="Cash" value={money(summary.cash)} />
            <Stat
              label="Day P/L"
              value={`${dirGlyph(summary.dayPL)} ${signedMoney(summary.dayPL)}`}
              cls={dirClass(summary.dayPL)}
            />
            <Stat
              label="Unrealized P/L"
              value={`${dirGlyph(summary.unrealPL)} ${signedMoney(summary.unrealPL)}`}
              cls={dirClass(summary.unrealPL)}
            />
            <Stat label="Unrealized %" value={fmtPct(summary.unrealPct)} cls={dirClass(summary.unrealPct)} />
          </div>

          {/* Internal tabs */}
          <div className="flex items-center gap-1 border-b border-nx-border-strong bg-nx-panel-2 px-1 py-0.5" role="tablist" aria-label="Portfolio sections">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`px-2 py-0.5 text-[10px] tracking-wider ${tab === t ? "bg-nx-panel text-nx-amber" : "text-nx-muted hover:text-nx-text"}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === "POSITIONS" && (
              <PositionsTab
                active={active}
                rows={rows}
                total={summary.total}
                hasOptions={hasOptions}
                onOpen={(s) => open("security", s)}
                onChanged={retry}
              />
            )}
            {tab === "ANALYTICS" && (
              <AnalyticsTab
                rows={rows}
                analytics={analytics}
                risk={risk}
                curve={curve}
                invested={summary.invested}
                barsLoading={barsLoading}
              />
            )}
            {tab === "TRANSACTIONS" && <TransactionsTab portfolio={active} />}
            {tab === "CALENDAR" && <CalendarTab events={events} />}
            {tab === "SCENARIOS" && (
              <ScenariosTab rows={rows} total={summary.total} betaOf={(s) => infoMap.get(s)?.beta ?? null} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, cls, title }: { label: string; value: string; cls?: string; title?: string }) {
  return (
    <div className="bg-nx-panel px-2 py-1" title={title}>
      <div className="text-[9px] uppercase tracking-widest text-nx-muted">{label}</div>
      <div className={`text-[13px] tabular-nums ${cls ?? "text-nx-text-bright"}`}>{value}</div>
    </div>
  );
}

// ─── POSITIONS ──────────────────────────────────────────────────────────────

function PositionsTab({
  active, rows, total, hasOptions, onOpen, onChanged,
}: {
  active: Portfolio;
  rows: PositionRow[];
  total: number;
  hasOptions: boolean;
  onOpen: (s: string) => void;
  onChanged: () => void;
}) {
  const [showTxn, setShowTxn] = useState(false);
  const [form, setForm] = useState({ symbol: "", side: "BUY" as (typeof TXN_SIDES)[number], quantity: "", price: "", fees: "", date: "", note: "" });
  const [txnErr, setTxnErr] = useState<string | null>(null);
  const [txnBusy, setTxnBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const isCashSide = form.side === "DEPOSIT" || form.side === "WITHDRAWAL";

  const prefillPrice = async () => {
    const sym = form.symbol.trim().toUpperCase();
    if (!SYMBOL_RE.test(sym) || isCashSide) return;
    try {
      const qs = await api<Quote[]>(`/api/quote?symbols=${encodeURIComponent(sym)}`);
      const q = qs[0];
      if (q) setForm((f) => ({ ...f, price: q.price.toFixed(2) }));
    } catch { /* leave price blank */ }
  };

  const submitTxn = async () => {
    const symbol = isCashSide ? "USD" : form.symbol.trim().toUpperCase();
    const qty = Number(form.quantity);
    const price = isCashSide ? 0 : Number(form.price);
    const fees = form.fees.trim() ? Number(form.fees) : 0;
    if (!SYMBOL_RE.test(symbol)) return setTxnErr("Invalid symbol (1–12 chars: A–Z 0–9 . - ^ =)");
    if (!Number.isFinite(qty) || qty <= 0) return setTxnErr(isCashSide ? "Amount must be positive" : "Quantity must be positive");
    if (!Number.isFinite(price) || price < 0) return setTxnErr("Price must be a non-negative number");
    if (!Number.isFinite(fees) || fees < 0) return setTxnErr("Fees must be non-negative");
    if (form.date && Number.isNaN(new Date(form.date).getTime())) return setTxnErr("Invalid date");
    setTxnBusy(true);
    try {
      await api(`/api/portfolios/${active.id}/transactions`, {
        method: "POST",
        body: JSON.stringify({
          symbol,
          side: form.side,
          quantity: qty,
          price,
          fees,
          ...(form.date ? { executedAt: new Date(form.date).toISOString() } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        }),
      });
      setForm({ symbol: "", side: "BUY", quantity: "", price: "", fees: "", date: "", note: "" });
      setTxnErr(null);
      setShowTxn(false);
      onChanged();
    } catch (e) {
      setTxnErr(e instanceof ApiError ? e.message : "Transaction failed");
    } finally {
      setTxnBusy(false);
    }
  };

  const importCsv = async () => {
    if (!csvFile) return;
    setCsvBusy(true);
    try {
      const text = await csvFile.text();
      const res = await api<{ imported: number; cash: number }>(`/api/portfolios/${active.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text,
      });
      setCsvMsg({ ok: true, text: `Imported ${res.imported} transaction${res.imported === 1 ? "" : "s"} · cash now ${money(res.cash)}` });
      setCsvFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (e) {
      setCsvMsg({ ok: false, text: e instanceof Error ? e.message : "Import failed" });
    } finally {
      setCsvBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexus-transactions-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-nx-border px-2 py-1">
        <button onClick={() => setShowTxn((v) => !v)} className={btnCls} aria-expanded={showTxn}>
          {showTxn ? "− Hide form" : "＋ Add transaction"}
        </button>
        <span className="h-3 w-px bg-nx-border-strong" aria-hidden />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-label="Choose CSV file to import"
          onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
          className="w-44 text-[10px] text-nx-muted file:border file:border-nx-border file:bg-nx-panel-2 file:px-1 file:text-[10px] file:text-nx-cyan"
        />
        <button onClick={() => void importCsv()} disabled={!csvFile || csvBusy} className={btnCls}>
          {csvBusy ? "Importing…" : "Import CSV"}
        </button>
        <button onClick={downloadTemplate} className={`${btnCls} text-nx-cyan`}>
          Download CSV template
        </button>
        {csvMsg && (
          <span className={`text-[10px] ${csvMsg.ok ? "text-nx-up" : "text-nx-down"}`} role={csvMsg.ok ? "status" : "alert"}>
            {csvMsg.ok ? "✓" : "⚠"} {csvMsg.text}
          </span>
        )}
      </div>

      {showTxn && (
        <form
          className="flex flex-wrap items-end gap-2 border-b border-nx-border bg-nx-panel-2 px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submitTxn();
          }}
        >
          <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            Side
            <select
              value={form.side}
              onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as (typeof TXN_SIDES)[number] }))}
              className={inputCls}
            >
              {TXN_SIDES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            Symbol
            <input
              value={isCashSide ? "USD" : form.symbol}
              disabled={isCashSide}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
              onBlur={() => void prefillPrice()}
              placeholder="AAPL"
              className={`${inputCls} w-20 disabled:opacity-50`}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            {isCashSide ? "Amount" : "Quantity"}
            <input
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              inputMode="decimal"
              placeholder="10"
              className={`${inputCls} w-20 tabular-nums`}
            />
          </label>
          {!isCashSide && (
            <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
              Price
              <input
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                inputMode="decimal"
                placeholder="0.00"
                className={`${inputCls} w-20 tabular-nums`}
              />
            </label>
          )}
          <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            Fees
            <input
              value={form.fees}
              onChange={(e) => setForm((f) => ({ ...f, fees: e.target.value }))}
              inputMode="decimal"
              placeholder="0"
              className={`${inputCls} w-16 tabular-nums`}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            Date
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="flex min-w-28 flex-1 flex-col gap-0.5 text-[9px] uppercase tracking-wider text-nx-muted">
            Note
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              maxLength={200}
              placeholder="optional"
              className={inputCls}
            />
          </label>
          <button type="submit" disabled={txnBusy} className={btnCls}>
            {txnBusy ? "Recording…" : "Record"}
          </button>
          {txnErr && <span className="text-[10px] text-nx-down" role="alert">⚠ {txnErr}</span>}
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState message="No positions in this portfolio" hint="Add a transaction above, or import a CSV of past fills" />
      ) : (
        <>
          <table className="nx-table" aria-label="Positions">
            <thead>
              <tr>
                <th>Symbol</th><th>Class</th><th>Qty</th><th>Avg Cost</th><th>Last</th>
                <th>Mkt Value</th><th>Day P/L</th><th>Unreal P/L</th><th>Unreal %</th><th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.position;
                const weight = total > 0 ? r.mktValue / total : 0;
                return (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => onOpen(p.symbol)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(p.symbol)}
                  >
                    <td className="font-semibold text-nx-cyan">
                      {p.symbol}
                      {p.assetClass === "OPTION" && (
                        <span className="ml-1 text-[9px] font-normal text-nx-purple">
                          {p.optionType} {p.strike != null ? fmtPrice(p.strike, "") : ""} {p.expiry ?? ""}
                        </span>
                      )}
                    </td>
                    <td className="text-[10px] text-nx-muted">{p.assetClass}</td>
                    <td className="tabular-nums text-nx-text">{fmtNum(p.quantity, p.quantity % 1 === 0 ? 0 : 4)}</td>
                    <td className="tabular-nums text-nx-muted">{fmtPrice(p.avgCost, "")}</td>
                    <td className="tabular-nums text-nx-text-bright" title={r.mark.live ? undefined : "Marked at cost"}>
                      {r.mark.live ? fmtPrice(r.mark.price, "") : `${fmtPrice(r.mark.price, "")}*`}
                    </td>
                    <td className="tabular-nums text-nx-text">{money(r.mktValue)}</td>
                    <td className={`tabular-nums ${dirClass(r.dayPL)}`}>
                      {dirGlyph(r.dayPL)} {fmtSigned(r.dayPL)}
                    </td>
                    <td className={`tabular-nums ${dirClass(r.unrealPL)}`}>
                      {dirGlyph(r.unrealPL)} {fmtSigned(r.unrealPL)}
                    </td>
                    <td className={`tabular-nums ${dirClass(r.unrealPct)}`}>{fmtPct(r.unrealPct)}</td>
                    <td className="tabular-nums text-nx-muted">{fmtPct(weight, 1, false)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-2 py-1 text-[9px] text-nx-faint">
            * marked at cost (quote unavailable){hasOptions ? " · option — marked at cost (live option marks unavailable)" : ""} · marks refresh every 20s
          </div>
        </>
      )}
    </div>
  );
}

// ─── ANALYTICS ──────────────────────────────────────────────────────────────

function AnalyticsTab({
  rows, analytics, risk, curve, invested, barsLoading,
}: {
  rows: PositionRow[];
  analytics: {
    byClass: { label: string; value: number; weight: number }[];
    bySector: { label: string; value: number; weight: number }[];
    conc: { top5Weight: number; largestSymbol: string | null; largestWeight: number; hhi: number };
    beta: number | null;
    income: { dividends: number; premiums: number };
  };
  risk: { points: number; vol: number | null; maxDD: number | null; var95: number | null };
  curve: number[];
  invested: number;
  barsLoading: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState message="Nothing to analyze" hint="Add positions first — analytics appear here" />;
  }
  const noIncome = analytics.income.dividends === 0 && analytics.income.premiums === 0;
  return (
    <div className="grid grid-cols-1 gap-px bg-nx-border md:grid-cols-2">
      <div className="bg-nx-panel">
        <section aria-label="Allocation by asset class">
          <SectionTitle>Allocation · Asset Class</SectionTitle>
          <BarList slices={analytics.byClass} />
        </section>
        <section aria-label="Allocation by sector">
          <SectionTitle>Allocation · Sector</SectionTitle>
          <BarList slices={analytics.bySector} />
          <div className="px-2 pb-1 text-[9px] text-nx-faint">
            Sector via screener universe mapping; weights are % of invested value (cash excluded).
          </div>
        </section>
        <section aria-label="Income">
          <SectionTitle>Dividend / Premium Income</SectionTitle>
          <dl className="nx-kv p-2">
            <dt>Dividends</dt><dd className="text-nx-text-bright">{money(analytics.income.dividends)}</dd>
            <dt>Premiums</dt><dd className="text-nx-text-bright">{money(analytics.income.premiums)}</dd>
          </dl>
          {noIncome && (
            <div className="px-2 pb-1 text-[9px] text-nx-faint">No income recorded — record dividends via CSV import.</div>
          )}
        </section>
      </div>

      <div className="bg-nx-panel">
        <section aria-label="Concentration">
          <SectionTitle>Concentration</SectionTitle>
          <dl className="nx-kv p-2">
            <dt>Top-5 weight</dt><dd className="text-nx-text-bright">{fmtPct(analytics.conc.top5Weight, 1, false)}</dd>
            <dt>Largest position</dt>
            <dd className="text-nx-text-bright">
              {analytics.conc.largestSymbol ?? "—"} {analytics.conc.largestSymbol ? `(${fmtPct(analytics.conc.largestWeight, 1, false)})` : ""}
            </dd>
            <dt>HHI</dt><dd className="text-nx-text-bright">{analytics.conc.hhi.toFixed(3)}</dd>
          </dl>
          <div className="px-2 pb-1 text-[9px] text-nx-faint">HHI of position weights: 1.0 = single position, lower = more diversified.</div>
        </section>
        <section aria-label="Risk metrics">
          <SectionTitle
            right={curve.length >= 2 ? <Sparkline values={curve} width={120} height={18} /> : undefined}
          >
            Risk · 120-day equity curve
          </SectionTitle>
          {barsLoading ? (
            <div className="p-2 text-[10px] text-nx-muted">Loading price history…</div>
          ) : risk.points < 30 ? (
            <div className="p-2 text-[10px] text-nx-muted">
              Insufficient data ({risk.points} of 30 required points) — vol, drawdown and VaR unavailable.
            </div>
          ) : (
            <dl className="nx-kv p-2">
              <dt>Portfolio beta</dt><dd className="text-nx-text-bright">{analytics.beta != null ? analytics.beta.toFixed(2) : "—"}</dd>
              <dt>Annualized vol</dt><dd className="text-nx-text-bright">{fmtPct(risk.vol, 1, false)}</dd>
              <dt>Max drawdown</dt><dd className="text-nx-down">▼ {fmtPct(risk.maxDD, 1, false)}</dd>
              <dt>VaR 95% (1-day)</dt>
              <dd className="text-nx-text-bright">
                {risk.var95 != null ? `${fmtPct(risk.var95, 2, false)} · ${money(risk.var95 * invested)}` : "—"}
              </dd>
            </dl>
          )}
          <div className="px-2 pb-1 text-[9px] text-nx-faint">
            Curve = current weights × rebased daily closes (top {Math.min(10, rows.length)} non-option symbols, 6M).
            Beta is value-weighted where known. VaR is parametric-normal on daily returns.
          </div>
        </section>
      </div>
    </div>
  );
}

function BarList({ slices }: { slices: { label: string; value: number; weight: number }[] }) {
  if (slices.length === 0) return <div className="p-2 text-[10px] text-nx-muted">—</div>;
  return (
    <div className="space-y-px p-1" role="list">
      {slices.map((s) => (
        <div key={s.label} role="listitem" className="flex items-center gap-2 px-1 text-[10px]">
          <span className="w-40 truncate text-nx-muted">{s.label}</span>
          <div className="h-2.5 flex-1 bg-nx-inset" aria-hidden>
            <div className="h-full bg-nx-cyan/50" style={{ width: `${Math.max(2, s.weight * 100)}%` }} />
          </div>
          <span className="w-20 text-right tabular-nums text-nx-text">{fmtCompact(s.value)}</span>
          <span className="w-14 text-right tabular-nums text-nx-muted">{fmtPct(s.weight, 1, false)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── TRANSACTIONS ───────────────────────────────────────────────────────────

function TransactionsTab({ portfolio }: { portfolio: Portfolio }) {
  const [filter, setFilter] = useState("");
  const txns = useMemo(() => {
    const all = [...portfolio.transactions].sort(
      (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
    );
    const f = filter.trim().toUpperCase();
    return f ? all.filter((t) => t.symbol.toUpperCase().includes(f)) : all;
  }, [portfolio, filter]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-nx-border px-2 py-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value.toUpperCase())}
          placeholder="Filter by symbol…"
          aria-label="Filter transactions by symbol"
          className={`${inputCls} w-32`}
        />
        <span className="text-[10px] text-nx-faint">{txns.length} of {portfolio.transactions.length}</span>
      </div>
      {txns.length === 0 ? (
        <EmptyState message="No transactions" hint={filter ? "No match for this filter" : "Record a transaction or import a CSV"} />
      ) : (
        <table className="nx-table" aria-label="Transactions">
          <thead>
            <tr>
              <th>Date</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Fees</th><th>Value</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id}>
                <td className="tabular-nums text-nx-muted">{fmtDateTime(t.executedAt)}</td>
                <td className="font-semibold text-nx-cyan">{t.symbol}</td>
                <td className={t.side === "BUY" || t.side === "DEPOSIT" ? "text-nx-up" : t.side === "SELL" || t.side === "WITHDRAWAL" ? "text-nx-down" : "text-nx-muted"}>
                  {t.side}
                </td>
                <td className="tabular-nums text-nx-text">{fmtNum(t.quantity, t.quantity % 1 === 0 ? 0 : 4)}</td>
                <td className="tabular-nums text-nx-text-bright">{fmtPrice(t.price, "")}</td>
                <td className="tabular-nums text-nx-muted">{fmtPrice(t.fees, "")}</td>
                <td className="tabular-nums text-nx-text">{money(t.quantity * t.price)}</td>
                <td className="max-w-48 truncate text-[10px] text-nx-muted" title={t.note ?? undefined}>{t.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── CALENDAR ───────────────────────────────────────────────────────────────

function CalendarTab({ events }: { events: CalEvent[] }) {
  return (
    <div>
      <SectionTitle>Upcoming Events</SectionTitle>
      {events.length === 0 ? (
        <EmptyState message="No upcoming events" hint="Option expiries and earnings for held symbols appear here" />
      ) : (
        <table className="nx-table" aria-label="Upcoming events">
          <thead>
            <tr><th>Date</th><th>In</th><th>Type</th><th>Event</th></tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.kind}-${e.label}-${i}`}>
                <td className="tabular-nums text-nx-text-bright">{e.date}</td>
                <td className={`tabular-nums ${e.days <= 7 ? "text-nx-warn" : "text-nx-muted"}`}>
                  {e.days === 0 ? "today" : `${e.days}d`}
                </td>
                <td className="text-[10px] text-nx-muted">{e.kind === "OPTION_EXPIRY" ? "Option expiry" : "Earnings"}</td>
                <td className="text-nx-text">{e.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="px-2 py-1 text-[9px] text-nx-faint">
        Earnings capped at 8 held symbols · dividend dates unavailable in demo.
      </div>
    </div>
  );
}

// ─── SCENARIOS ──────────────────────────────────────────────────────────────

function ScenariosTab({
  rows, total, betaOf,
}: {
  rows: PositionRow[];
  total: number;
  betaOf: (symbol: string) => number | null;
}) {
  const [sel, setSel] = useState<{ kind: ScenarioKind; pct: number; label: string } | null>(null);
  const [customPct, setCustomPct] = useState("5");

  const impact = useMemo(
    () => (sel ? scenarioImpact(rows, sel.kind, sel.pct, betaOf) : []),
    [rows, sel, betaOf],
  );
  const totalImpact = impact.reduce((a, r) => a + r.pl, 0);

  const applyCustom = () => {
    const pct = Number(customPct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 100) return;
    setSel({ kind: "custom", pct: pct / 100, label: `Custom ${pct > 0 ? "+" : "−"}${Math.abs(pct)}% equities` });
  };

  if (rows.length === 0) {
    return <EmptyState message="No positions to shock" hint="Add positions first — scenario impacts appear here" />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-nx-border px-2 py-1" role="group" aria-label="Scenario presets">
        <button onClick={() => setSel({ kind: "market", pct: -0.1, label: "Market −10% (beta-adjusted)" })} className={btnCls}>Market −10%</button>
        <button onClick={() => setSel({ kind: "market", pct: 0.1, label: "Market +10% (beta-adjusted)" })} className={btnCls}>Market +10%</button>
        <button onClick={() => setSel({ kind: "crypto", pct: -0.2, label: "BTC −20% (crypto sleeve)" })} className={btnCls}>BTC −20%</button>
        <button onClick={() => setSel({ kind: "crypto", pct: 0.2, label: "BTC +20% (crypto sleeve)" })} className={btnCls}>BTC +20%</button>
        <span className="h-3 w-px bg-nx-border-strong" aria-hidden />
        <label className="flex items-center gap-1 text-[10px] text-nx-muted">
          Equities
          <input
            value={customPct}
            onChange={(e) => setCustomPct(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustom()}
            inputMode="decimal"
            aria-label="Custom shock percent"
            className={`${inputCls} w-14 text-right tabular-nums`}
          />
          %
        </label>
        <button onClick={applyCustom} className={btnCls}>Apply</button>
      </div>

      {!sel ? (
        <EmptyState message="Select a scenario above" hint="Preset shocks or a custom % applied to equity positions" />
      ) : impact.length === 0 ? (
        <EmptyState message={`No affected positions for "${sel.label}"`} hint="This shock only applies to matching asset classes" />
      ) : (
        <>
          <SectionTitle>{sel.label}</SectionTitle>
          <table className="nx-table" aria-label="Scenario impact">
            <thead>
              <tr><th>Symbol</th><th>Class</th><th>Value</th><th>Shock</th><th>P/L Impact</th></tr>
            </thead>
            <tbody>
              {impact.map((r, i) => (
                <tr key={`${r.symbol}-${i}`}>
                  <td className="font-semibold text-nx-cyan">{r.symbol}</td>
                  <td className="text-[10px] text-nx-muted">{r.assetClass}</td>
                  <td className="tabular-nums text-nx-text">{money(r.value)}</td>
                  <td className={`tabular-nums ${dirClass(r.shockPct)}`}>{fmtPct(r.shockPct, 1)}</td>
                  <td className={`tabular-nums ${dirClass(r.pl)}`}>
                    {dirGlyph(r.pl)} {fmtSigned(r.pl)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-[10px] uppercase tracking-wider text-nx-muted">
                  Total impact
                </td>
                <td className={`tabular-nums font-semibold ${dirClass(totalImpact)}`}>
                  {dirGlyph(totalImpact)} {fmtSigned(totalImpact)} ({fmtPct(total > 0 ? totalImpact / total : null, 2)})
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
      <div className="px-2 py-1 text-[9px] text-nx-faint">
        Hypothetical instantaneous shocks for risk illustration — not predictions.
        Market shocks are beta-adjusted (beta = 1 when unknown); options excluded (marked at cost, no live greeks).
      </div>
    </div>
  );
}
