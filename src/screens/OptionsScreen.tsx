"use client";

// OPTIONS — flagship options terminal: chain, volatility, and strategy builder.
// All probabilities/estimates are model-based and always carry a caveat.

import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, Loading, ProvenanceBadge, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtCompact, fmtNum, fmtPct, fmtPrice, fmtRelative, fmtSigned } from "@/lib/format";
import type { OptionContract, OptionsChain } from "@/lib/types";
import {
  TEMPLATES,
  atmIv,
  breakEvens,
  buildTemplate,
  chainCsv,
  legDescription,
  makeOptionLeg,
  maxProfitLoss,
  netPremium,
  pnlCurve,
  positionGreeks,
  probOfProfit,
  skew25,
  strategyCsv,
  timeToExpiryYears,
  type PnlPoint,
  type StrategyLeg,
  type TemplateId,
} from "./optionsUtils";

type NoOptions = { noOptions: true; symbol: string; message: string };
type ChainResponse = OptionsChain | NoOptions;
type TabId = "CHAIN" | "VOLATILITY" | "STRATEGY";

const MODEL_CAVEAT = "log-normal model estimate, IV-based — not a guarantee";

// ─── Small helpers ──────────────────────────────────────────────────────────

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Signed dollar amount for P/L values: +$1,234.00 / −$1,234.00 */
function fmtPnl(n: number): string {
  const s = fmtNum(Math.abs(n));
  return n > 0 ? `+$${s}` : n < 0 ? `−$${s}` : `$${s}`;
}

/** Bounded-or-unbounded P/L extreme. */
function fmtExtreme(n: number | null): string {
  return n == null ? "Unbounded" : fmtPnl(n);
}

interface Liquidity {
  letter: "T" | "M" | "W";
  cls: string;
  label: string;
}

/** Liquidity tier from bid/ask spread as a fraction of mid. Letter + tooltip, never color alone. */
function liquidity(spreadPct: number): Liquidity {
  if (spreadPct < 0.05) return { letter: "T", cls: "text-nx-cyan", label: "Tight spread (<5% of mid) — liquid" };
  if (spreadPct <= 0.15) return { letter: "M", cls: "text-nx-warn", label: "Moderate spread (5–15% of mid)" };
  return { letter: "W", cls: "text-nx-down", label: "Wide spread (>15% of mid) — illiquid, use limit orders" };
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function OptionsScreen({ symbol = "SPY" }: { symbol?: string }) {
  const sym = symbol.toUpperCase();
  const [tab, setTab] = useState<TabId>("CHAIN");
  const [chosenExpiry, setChosenExpiry] = useState<string | null>(null);
  const [showGreeks, setShowGreeks] = useState(false);
  const [legs, setLegs] = useState<StrategyLeg[]>([]);
  const [template, setTemplate] = useState<TemplateId | "custom" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const path = `/api/options?symbol=${encodeURIComponent(sym)}${chosenExpiry ? `&expiry=${chosenExpiry}` : ""}`;
  const { data, error, loading, retry } = useApi<ChainResponse>(path);

  // Fresh context per symbol
  useEffect(() => {
    setChosenExpiry(null);
    setLegs([]);
    setTemplate(null);
  }, [sym]);

  const chain = data && !("noOptions" in data) ? data : null;
  const noOpts = data && "noOptions" in data ? data : null;

  // Legs belong to one chain — clear them if the chain identity changes
  const chainKey = chain ? `${chain.symbol}:${chain.expiry}` : "";
  const prevChainKey = useRef(chainKey);
  useEffect(() => {
    if (prevChainKey.current !== chainKey) {
      prevChainKey.current = chainKey;
      setLegs([]);
      setTemplate(null);
    }
  }, [chainKey]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const showFlash = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
  };

  const addContract = (c: OptionContract) => {
    const leg = makeOptionLeg(c, "BUY", 1);
    setLegs((ls) => [...ls, leg]);
    setTemplate("custom");
    showFlash(`Added ${legDescription(leg)} to strategy — see STRATEGY tab`);
  };

  const applyTemplate = (id: TemplateId) => {
    if (!chain) return;
    const built = buildTemplate(id, chain);
    const name = TEMPLATES.find((t) => t.id === id)?.name ?? id;
    if (!built) {
      showFlash(`Cannot build ${name}: chain lacks suitable contracts`);
      return;
    }
    setLegs(built);
    setTemplate(id);
    showFlash(`${name} built from ${chain.expiry} chain`);
  };

  const startCustom = () => {
    setLegs([]);
    setTemplate("custom");
    showFlash("Custom strategy — click contracts in the CHAIN tab to add legs");
  };

  if (loading && !data) return <Loading label={`Loading ${sym} options`} />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;
  if (noOpts) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <EmptyState message={noOpts.message} hint="Try an optionable symbol such as SPY or AAPL" />
      </div>
    );
  }
  if (!chain) return null;

  const em = chain.expectedMove;
  const expiryValue = chosenExpiry ?? chain.expiry;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label={`${chain.symbol} options`}>
      {chain.status === "SAMPLE" && <SampleBanner />}

      {/* Tab strip */}
      <div className="flex items-center border-b border-nx-border-strong bg-nx-panel" role="tablist" aria-label="Options views">
        {(["CHAIN", "VOLATILITY", "STRATEGY"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            data-active={tab === t}
            onClick={() => setTab(t)}
            className="nx-tab"
          >
            {t}
            {t === "STRATEGY" && legs.length > 0 ? ` (${legs.length})` : ""}
          </button>
        ))}
        <span className="flex-1" />
        {flash && (
          <span role="status" aria-live="polite" className="px-2 text-[10px] text-nx-cyan">
            {flash}
          </span>
        )}
      </div>

      {/* Toolbar: expiry, expected move, provenance */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-nx-border px-2 py-1 text-[10px] text-nx-muted">
        <span className="text-[11px] font-semibold text-nx-cyan">{chain.symbol}</span>
        <span className="tabular-nums text-nx-text-bright">${fmtPrice(chain.underlyingPrice, "")}</span>
        <label className="flex items-center gap-1">
          <span>Expiry</span>
          <select
            value={expiryValue}
            onChange={(e) => setChosenExpiry(e.target.value)}
            aria-label="Select expiration"
            className="border border-nx-border bg-nx-inset px-1 py-px text-[11px] text-nx-text"
          >
            {chain.expiries.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <span className="tabular-nums" title="One standard deviation implied by the ATM straddle">
          Expected move ±${fmtNum(em.absolute)} (±{fmtNum(em.pct * 100, 1)}%) by {chain.expiry} — 1σ, model estimate, not a guarantee
        </span>
        <span className="flex-1" />
        <ProvenanceBadge prov={chain} />
        <span>Updated {fmtRelative(chain.asOf)}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "CHAIN" && (
          <ChainTab chain={chain} showGreeks={showGreeks} onToggleGreeks={() => setShowGreeks((g) => !g)} onAdd={addContract} />
        )}
        {tab === "VOLATILITY" && <VolTab chain={chain} />}
        {tab === "STRATEGY" && (
          <StrategyTab chain={chain} legs={legs} setLegs={setLegs} template={template} onTemplate={applyTemplate} onCustom={startCustom} />
        )}
      </div>
    </div>
  );
}

// ─── CHAIN tab ──────────────────────────────────────────────────────────────

interface StrikeRow {
  strike: number;
  call?: OptionContract;
  put?: OptionContract;
}

function ChainTab({
  chain,
  showGreeks,
  onToggleGreeks,
  onAdd,
}: {
  chain: OptionsChain;
  showGreeks: boolean;
  onToggleGreeks: () => void;
  onAdd: (c: OptionContract) => void;
}) {
  const spot = chain.underlyingPrice;

  const rows = useMemo<StrikeRow[]>(() => {
    const byStrike = new Map<number, StrikeRow>();
    for (const c of chain.contracts) {
      const row = byStrike.get(c.strike) ?? { strike: c.strike };
      if (c.type === "CALL") row.call = c;
      else row.put = c;
      byStrike.set(c.strike, row);
    }
    return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  }, [chain.contracts]);

  const atmStrike = useMemo(() => {
    let best: number | null = null;
    for (const r of rows) {
      if (best === null || Math.abs(r.strike - spot) < Math.abs(best - spot)) best = r.strike;
    }
    return best;
  }, [rows, spot]);

  const sideCols = showGreeks ? 13 : 9;

  const halfCells = (c: OptionContract | undefined, side: "CALL" | "PUT") => {
    if (!c) return <td colSpan={sideCols} className="bg-nx-inset/40" aria-label={`No ${side.toLowerCase()} at this strike`} />;
    const itm = side === "CALL" ? c.strike < spot : c.strike > spot;
    const liq = liquidity(c.spreadPct);
    const cell = {
      onClick: () => onAdd(c),
      className: `cursor-pointer tabular-nums ${itm ? "bg-nx-amber/5" : ""}`,
    };
    return (
      <>
        <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtPrice(c.bid, "")}</td>
        <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtPrice(c.ask, "")}</td>
        <td {...cell} className={`${cell.className} text-nx-text-bright`}>{fmtPrice(c.mid, "")}</td>
        <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtPrice(c.last, "")}</td>
        <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtCompact(c.volume)}</td>
        <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtCompact(c.openInterest)}</td>
        <td {...cell} className={`${cell.className} text-nx-text`}>{fmtNum(c.iv * 100, 1)}</td>
        <td {...cell} className={`${cell.className} ${c.delta >= 0 ? "text-nx-up" : "text-nx-down"}`}>{fmtSigned(c.delta)}</td>
        {showGreeks && (
          <>
            <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtNum(c.gamma, 3)}</td>
            <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtSigned(c.theta)}</td>
            <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtNum(c.vega)}</td>
            <td {...cell} className={`${cell.className} text-nx-muted`}>{fmtSigned(c.rho)}</td>
          </>
        )}
        <td {...cell} className={cell.className}>
          <span className={liq.cls} title={liq.label} aria-label={`Spread ${fmtPct(c.spreadPct, 1, false)}, ${liq.label}`}>
            {fmtPct(c.spreadPct, 1, false)} {liq.letter}
          </span>
        </td>
      </>
    );
  };

  const greekHeaders = showGreeks ? (
    <>
      <th>Γ</th>
      <th>Θ</th>
      <th>Vega</th>
      <th>Ρ</th>
    </>
  ) : null;

  return (
    <section aria-label={`${chain.symbol} option chain, expiry ${chain.expiry}`}>
      <SectionTitle
        right={
          <span className="flex items-center gap-2">
            <button
              onClick={onToggleGreeks}
              aria-pressed={showGreeks}
              className="border border-nx-border px-2 py-px text-[10px] text-nx-muted hover:text-nx-text"
            >
              Greeks {showGreeks ? "−" : "+"}
            </button>
            <button
              onClick={() => downloadCsv(`${chain.symbol}_${chain.expiry}_chain.csv`, chainCsv(chain))}
              className="border border-nx-border px-2 py-px text-[10px] text-nx-amber hover:bg-nx-panel-2"
            >
              Export CSV
            </button>
          </span>
        }
      >
        {chain.symbol} Chain · {chain.expiry}
      </SectionTitle>

      <table className="nx-table" aria-label="Calls left, strikes center, puts right. Click a side to add that contract to the strategy builder.">
        <thead>
          <tr>
            <th colSpan={sideCols} className="text-center text-nx-cyan">Calls</th>
            <th className="text-center">Strike</th>
            <th colSpan={sideCols} className="text-center text-nx-purple">Puts</th>
          </tr>
          <tr>
            <th>Bid</th><th>Ask</th><th>Mid</th><th>Last</th><th>Vol</th><th>OI</th><th>IV%</th><th>Δ</th>
            {greekHeaders}
            <th title="Bid/ask spread as % of mid, with liquidity tier">Sprd</th>
            <th className="bg-nx-panel-2 text-center">$</th>
            <th>Bid</th><th>Ask</th><th>Mid</th><th>Last</th><th>Vol</th><th>OI</th><th>IV%</th><th>Δ</th>
            {greekHeaders}
            <th title="Bid/ask spread as % of mid, with liquidity tier">Sprd</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isAtm = r.strike === atmStrike;
            return (
              <tr
                key={r.strike}
                tabIndex={0}
                aria-label={`Strike ${r.strike}${isAtm ? " (at the money)" : ""}. Enter adds the call, Shift+Enter adds the put to the strategy builder.`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey && r.put) onAdd(r.put);
                  else if (e.key === "Enter" && r.call) onAdd(r.call);
                }}
              >
                {halfCells(r.call, "CALL")}
                <td
                  className={`bg-nx-panel-2 text-center font-semibold tabular-nums ${isAtm ? "text-nx-amber" : "text-nx-text"}`}
                  title={isAtm ? "At the money" : undefined}
                >
                  {fmtNum(r.strike, r.strike % 1 === 0 ? 0 : 2)}
                  {isAtm ? " ●" : ""}
                </td>
                {halfCells(r.put, "PUT")}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-2 py-1 text-[9px] text-nx-faint">
        Shaded side = in the money · ● = at the money · Sprd letter: T tight &lt;5%, M moderate 5–15%, W wide &gt;15% of mid ·
        Click a call/put side (or Enter / Shift+Enter on a row) to add it to the strategy builder
      </div>
    </section>
  );
}

// ─── VOLATILITY tab ─────────────────────────────────────────────────────────

function VolTab({ chain }: { chain: OptionsChain }) {
  const spot = chain.underlyingPrice;
  const iv = atmIv(chain);
  const skew = skew25(chain);

  return (
    <div className="grid grid-cols-1 gap-px bg-nx-border xl:grid-cols-2">
      <div className="bg-nx-panel">
        <SectionTitle>Volatility Smile · {chain.expiry}</SectionTitle>
        <SmileChart chain={chain} />
        <div className="px-2 pb-1 text-[9px] text-nx-faint">
          Implied volatility by strike · dashed line = at the money (${fmtPrice(spot, "")})
        </div>
      </div>

      <div className="bg-nx-panel">
        <SectionTitle>Vol Snapshot</SectionTitle>
        <div className="p-2">
          <dl className="nx-kv">
            <dt>ATM IV</dt>
            <dd className="text-nx-text-bright">{iv != null ? fmtPct(iv, 1, false) : "—"}</dd>
            <dt>Expected move</dt>
            <dd className="tabular-nums">
              ±${fmtNum(chain.expectedMove.absolute)} ({fmtPct(chain.expectedMove.pct, 1, false)}) by {chain.expiry}
            </dd>
            {skew && (
              <>
                <dt>25Δ put IV</dt>
                <dd className="tabular-nums">{fmtPct(skew.putIv, 1, false)}</dd>
                <dt>25Δ call IV</dt>
                <dd className="tabular-nums">{fmtPct(skew.callIv, 1, false)}</dd>
                <dt>Skew (P−C)</dt>
                <dd className={`tabular-nums ${skew.diffPts >= 0 ? "text-nx-warn" : "text-nx-cyan"}`}>
                  {fmtSigned(skew.diffPts, 1)} pts — {skew.diffPts >= 0 ? "downside puts bid (typical equity skew)" : "upside calls bid"}
                </dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-[9px] text-nx-faint">Expected move and IV-derived reads are 1σ model estimates, not guarantees.</p>
        </div>
        <TermStructure symbol={chain.symbol} expiries={chain.expiries} />
      </div>
    </div>
  );
}

function SmileChart({ chain }: { chain: OptionsChain }) {
  const W = 720;
  const H = 260;
  const ml = 48;
  const mr = 14;
  const mt = 12;
  const mb = 30;
  const iw = W - ml - mr;
  const ih = H - mt - mb;

  const calls = chain.contracts.filter((c) => c.type === "CALL").sort((a, b) => a.strike - b.strike);
  const puts = chain.contracts.filter((c) => c.type === "PUT").sort((a, b) => a.strike - b.strike);
  if (calls.length < 2 && puts.length < 2) return <EmptyState message="Not enough strikes for a smile chart" />;

  let kMin = Infinity;
  let kMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const c of chain.contracts) {
    if (c.strike < kMin) kMin = c.strike;
    if (c.strike > kMax) kMax = c.strike;
    const v = c.iv * 100;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const vPad = Math.max(1, (vMax - vMin) * 0.1);
  vMin -= vPad;
  vMax += vPad;
  const X = (k: number) => ml + ((k - kMin) / (kMax - kMin || 1)) * iw;
  const Y = (v: number) => mt + (1 - (v - vMin) / (vMax - vMin)) * ih;

  const line = (cs: OptionContract[]) => cs.map((c) => `${X(c.strike).toFixed(1)},${Y(c.iv * 100).toFixed(1)}`).join(" ");
  const atmX = X(chain.underlyingPrice);
  const yTicks = [0, 1, 2, 3].map((i) => vMin + ((vMax - vMin) * i) / 3);
  const xTicks = [0, 1, 2, 3, 4].map((i) => kMin + ((kMax - kMin) * i) / 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`IV smile: calls range ${fmtNum(vMin + vPad, 1)}% to ${fmtNum(vMax - vPad, 1)}% across strikes ${fmtNum(kMin, 0)} to ${fmtNum(kMax, 0)}`}>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} stroke="var(--color-nx-border)" strokeWidth="0.5" />
          <text x={ml - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-nx-muted)">
            {fmtNum(v, 0)}%
          </text>
        </g>
      ))}
      {xTicks.map((k) => (
        <text key={`x${k}`} x={X(k)} y={H - mb + 12} textAnchor="middle" fontSize="9" fill="var(--color-nx-muted)">
          {fmtNum(k, 0)}
        </text>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--color-nx-faint)">
        Strike
      </text>
      <text x={10} y={mt + ih / 2} fontSize="9" fill="var(--color-nx-faint)" transform={`rotate(-90 10 ${mt + ih / 2})`} textAnchor="middle">
        IV %
      </text>
      <line x1={atmX} x2={atmX} y1={mt} y2={mt + ih} stroke="var(--color-nx-amber)" strokeWidth="0.75" strokeDasharray="3 3" />
      <text x={atmX + 3} y={mt + 9} fontSize="9" fill="var(--color-nx-amber)">
        ATM
      </text>
      {calls.length >= 2 && <polyline points={line(calls)} fill="none" stroke="var(--color-nx-cyan)" strokeWidth="1.25" />}
      {puts.length >= 2 && <polyline points={line(puts)} fill="none" stroke="var(--color-nx-purple)" strokeWidth="1.25" />}
      <text x={W - mr - 4} y={mt + 10} textAnchor="end" fontSize="9" fill="var(--color-nx-cyan)">
        — Calls
      </text>
      <text x={W - mr - 4} y={mt + 21} textAnchor="end" fontSize="9" fill="var(--color-nx-purple)">
        — Puts
      </text>
    </svg>
  );
}

interface TermRow {
  expiry: string;
  atmIv: number;
  emAbs: number;
  emPct: number;
}

function TermStructure({ symbol, expiries }: { symbol: string; expiries: string[] }) {
  const [rows, setRows] = useState<TermRow[] | null>(null);
  const key = `${symbol}:${expiries.slice(0, 3).join(",")}`;

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const targets = key.split(":")[1]?.split(",").filter(Boolean) ?? [];
    const sym = key.split(":")[0] ?? symbol;
    (async () => {
      const out: TermRow[] = [];
      for (const exp of targets) {
        try {
          const ch = await api<OptionsChain>(`/api/options?symbol=${encodeURIComponent(sym)}&expiry=${exp}`);
          const iv = atmIv(ch);
          if (iv != null) out.push({ expiry: exp, atmIv: iv, emAbs: ch.expectedMove.absolute, emPct: ch.expectedMove.pct });
        } catch {
          /* skip expiries that fail to load */
        }
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, symbol]);

  const first = rows?.[0];
  const last = rows && rows.length > 1 ? rows[rows.length - 1] : undefined;
  const note =
    first && last
      ? last.atmIv > first.atmIv * 1.02
        ? "Upward-sloping term structure — later expiries carry higher IV (typical)."
        : last.atmIv < first.atmIv * 0.98
          ? "Inverted term structure — near-term IV elevated (event risk?)."
          : "Flat term structure across the nearest expiries."
      : null;

  return (
    <section aria-label="IV term structure">
      <SectionTitle>Term Structure · first {Math.min(3, expiries.length)} expiries</SectionTitle>
      {!rows ? (
        <div className="p-2 text-[10px] text-nx-muted">Loading term structure…</div>
      ) : rows.length === 0 ? (
        <div className="p-2 text-[10px] text-nx-muted">Term structure unavailable</div>
      ) : (
        <>
          <table className="nx-table">
            <thead>
              <tr>
                <th>Expiry</th>
                <th>ATM IV</th>
                <th>Exp move $</th>
                <th>Exp move %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.expiry}>
                  <td className="text-nx-cyan">{r.expiry}</td>
                  <td className="tabular-nums text-nx-text-bright">{fmtPct(r.atmIv, 1, false)}</td>
                  <td className="tabular-nums text-nx-muted">±${fmtNum(r.emAbs)}</td>
                  <td className="tabular-nums text-nx-muted">±{fmtNum(r.emPct * 100, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <div className="px-2 py-1 text-[9px] text-nx-faint">{note} Model estimates, not guarantees.</div>}
        </>
      )}
    </section>
  );
}

// ─── STRATEGY tab ───────────────────────────────────────────────────────────

function StrategyTab({
  chain,
  legs,
  setLegs,
  template,
  onTemplate,
  onCustom,
}: {
  chain: OptionsChain;
  legs: StrategyLeg[];
  setLegs: (fn: (ls: StrategyLeg[]) => StrategyLeg[]) => void;
  template: TemplateId | "custom" | null;
  onTemplate: (id: TemplateId) => void;
  onCustom: () => void;
}) {
  const spot = chain.underlyingPrice;

  const curve = useMemo(() => pnlCurve(legs, spot), [legs, spot]);
  const bes = useMemo(() => breakEvens(legs, spot), [legs, spot]);
  const pl = useMemo(() => maxProfitLoss(legs, spot), [legs, spot]);
  const net = useMemo(() => netPremium(legs), [legs]);
  const greeks = useMemo(() => positionGreeks(legs), [legs]);
  const iv = atmIv(chain);
  const tYears = timeToExpiryYears(chain.expiry);
  const pop = useMemo(
    () => (iv != null ? probOfProfit(legs, spot, bes, tYears, iv) : null),
    [legs, spot, bes, tYears, iv],
  );

  const updateQty = (id: string, raw: string, max: number) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    const qty = Math.min(max, Math.max(1, n));
    setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, qty } : l)));
  };
  const flipSide = (id: string) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, side: l.side === "BUY" ? "SELL" : "BUY" } : l)));
  const removeLeg = (id: string) => setLegs((ls) => ls.filter((l) => l.id !== id));

  const exportCsv = () => {
    const summary: [string, string][] = [
      ["underlying", chain.symbol],
      ["spot", fmtPrice(spot, "")],
      ["expiry", chain.expiry],
      ["net premium", net >= 0 ? `debit ${fmtPnl(net)}` : `credit ${fmtPnl(-net)}`],
      ["max profit", fmtExtreme(pl.maxProfit)],
      ["max loss", fmtExtreme(pl.maxLoss)],
      ["break-evens", bes.map((b) => `$${fmtPrice(b, "")}`).join("; ") || "none in range"],
      ["prob of profit", pop != null ? `${fmtPct(pop, 1, false)} (${MODEL_CAVEAT})` : "n/a"],
      ["net delta", fmtSigned(greeks.delta)],
      ["net gamma", fmtSigned(greeks.gamma)],
      ["net theta", fmtSigned(greeks.theta)],
      ["net vega", fmtSigned(greeks.vega)],
    ];
    downloadCsv(`${chain.symbol}_${chain.expiry}_strategy.csv`, strategyCsv(legs, summary));
  };

  return (
    <div>
      {/* Template selector */}
      <SectionTitle>Strategy Templates</SectionTitle>
      <div className="flex flex-wrap gap-1 p-2" role="group" aria-label="Strategy templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onTemplate(t.id)}
            title={t.blurb}
            aria-pressed={template === t.id}
            className={`border px-2 py-0.5 text-[10px] ${
              template === t.id ? "border-nx-amber text-nx-amber" : "border-nx-border text-nx-muted hover:text-nx-text"
            }`}
          >
            {t.name}
          </button>
        ))}
        <button
          onClick={onCustom}
          title="Clear legs, then click contracts in the CHAIN tab"
          aria-pressed={template === "custom"}
          className={`border px-2 py-0.5 text-[10px] ${
            template === "custom" ? "border-nx-cyan text-nx-cyan" : "border-nx-border text-nx-muted hover:text-nx-text"
          }`}
        >
          Custom (clicked contracts)
        </button>
      </div>

      {legs.length === 0 ? (
        <EmptyState message="No strategy built yet" hint="Pick a template above, or click contracts in the CHAIN tab to add custom legs" />
      ) : (
        <div className="grid grid-cols-1 gap-px bg-nx-border xl:grid-cols-2">
          {/* Legs */}
          <div className="bg-nx-panel">
            <SectionTitle
              right={
                <button onClick={exportCsv} className="border border-nx-border px-2 py-px text-[10px] text-nx-amber hover:bg-nx-panel-2">
                  Export CSV
                </button>
              }
            >
              Legs · {chain.expiry}
            </SectionTitle>
            <table className="nx-table" aria-label="Strategy legs">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Contract</th>
                  <th>Mid</th>
                  <th>Delta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => (
                  <tr key={leg.id}>
                    <td>
                      <button
                        onClick={() => flipSide(leg.id)}
                        aria-label={`Toggle side, currently ${leg.side}`}
                        title="Click to flip BUY/SELL"
                        className={`font-semibold ${leg.side === "BUY" ? "text-nx-up" : "text-nx-down"}`}
                      >
                        {leg.side}
                      </button>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={leg.kind === "STOCK" ? 100000 : 100}
                        step={leg.kind === "STOCK" ? 100 : 1}
                        value={leg.qty}
                        onChange={(e) => updateQty(leg.id, e.target.value, leg.kind === "STOCK" ? 100000 : 100)}
                        aria-label={`Quantity for ${legDescription(leg)}`}
                        className="w-16 border border-nx-border bg-nx-inset px-1 text-right text-[11px] tabular-nums text-nx-text"
                      />
                    </td>
                    <td className="text-nx-text">{legDescription(leg)}</td>
                    <td className="tabular-nums text-nx-text-bright">{fmtPrice(leg.price, "")}</td>
                    <td className={`tabular-nums ${leg.contract && leg.contract.delta < 0 ? "text-nx-down" : "text-nx-muted"}`}>
                      {leg.contract ? fmtSigned(leg.contract.delta) : "+1.00"}
                    </td>
                    <td>
                      <button onClick={() => removeLeg(leg.id)} aria-label={`Remove ${legDescription(leg)}`} className="text-nx-faint hover:text-nx-down">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Greeks summary */}
            <SectionTitle>Position Greeks</SectionTitle>
            <div className="grid grid-cols-4 gap-1 p-2 text-center">
              <GreekStat label="Net Δ" value={fmtSigned(greeks.delta)} title="Directional exposure, share-equivalents" />
              <GreekStat label="Net Γ" value={fmtSigned(greeks.gamma)} title="Delta change per $1 move" />
              <GreekStat label="Net Θ" value={fmtSigned(greeks.theta)} title="$ P/L per calendar day, holding all else constant" />
              <GreekStat label="Net Vega" value={fmtSigned(greeks.vega)} title="$ P/L per 1 vol point move in IV" />
            </div>
          </div>

          {/* P/L + metrics */}
          <div className="bg-nx-panel">
            <SectionTitle>Expiration P/L</SectionTitle>
            <PnlChart curve={curve} bes={bes} maxProfit={pl.maxProfit} maxLoss={pl.maxLoss} spot={spot} />
            <div className="px-2 pb-1 text-[9px] text-nx-faint">
              Intrinsic value at expiry vs premium paid · options ×100 multiplier · ignores early assignment, dividends, fees, and margin
            </div>

            <SectionTitle>Metrics</SectionTitle>
            <div className="p-2">
              <dl className="nx-kv">
                <dt>Net premium</dt>
                <dd className={`tabular-nums ${net >= 0 ? "text-nx-text-bright" : "text-nx-up"}`}>
                  {net >= 0 ? `${fmtPnl(net)} debit` : `${fmtPnl(-net)} credit`}
                </dd>
                <dt>Max profit</dt>
                <dd className={`tabular-nums ${pl.maxProfit == null || pl.maxProfit > 0 ? "text-nx-up" : "text-nx-text"}`}>
                  {fmtExtreme(pl.maxProfit)}
                </dd>
                <dt>Max loss</dt>
                <dd className={`tabular-nums ${pl.maxLoss != null && pl.maxLoss < 0 ? "text-nx-down" : "text-nx-text"}`}>
                  {fmtExtreme(pl.maxLoss)}
                </dd>
                <dt>Break-evens</dt>
                <dd className="tabular-nums text-nx-text">
                  {bes.length > 0 ? bes.map((b) => `$${fmtPrice(b, "")}`).join(" · ") : "None (never crosses zero)"}
                </dd>
                <dt>Prob. of profit</dt>
                <dd className="tabular-nums text-nx-cyan">{pop != null ? fmtPct(pop, 1, false) : "—"}</dd>
              </dl>
              <p className="mt-2 border-t border-nx-border pt-1 text-[9px] text-nx-warn" role="note">
                Probabilities are {MODEL_CAVEAT}. Computed from ATM IV ({iv != null ? fmtPct(iv, 1, false) : "—"}) and time to expiry.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GreekStat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <div className="border border-nx-border bg-nx-inset px-1 py-1.5" title={title}>
      <div className="text-[9px] uppercase tracking-wider text-nx-muted">{label}</div>
      <div className="text-[12px] tabular-nums text-nx-text-bright">{value}</div>
    </div>
  );
}

function PnlChart({
  curve,
  bes,
  maxProfit,
  maxLoss,
  spot,
}: {
  curve: PnlPoint[];
  bes: number[];
  maxProfit: number | null;
  maxLoss: number | null;
  spot: number;
}) {
  const W = 720;
  const H = 280;
  const ml = 64;
  const mr = 14;
  const mt = 14;
  const mb = 26;
  const iw = W - ml - mr;
  const ih = H - mt - mb;

  const first = curve[0];
  const lastPt = curve[curve.length - 1];
  if (!first || !lastPt || curve.length < 2) return null;
  const sMin = first.s;
  const sMax = lastPt.s;

  let yMin = 0;
  let yMax = 0;
  for (const p of curve) {
    if (p.pnl < yMin) yMin = p.pnl;
    if (p.pnl > yMax) yMax = p.pnl;
  }
  if (maxProfit != null) yMax = Math.max(yMax, maxProfit);
  if (maxLoss != null) yMin = Math.min(yMin, maxLoss);
  if (yMax - yMin < 1) {
    yMax += 1;
    yMin -= 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMax += pad;
  yMin -= pad;

  const X = (s: number) => ml + ((s - sMin) / (sMax - sMin)) * iw;
  const Y = (v: number) => mt + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const y0 = Y(0);

  // Zero-line shading: split the curve into above/below runs at crossings
  const posPaths: string[] = [];
  const negPaths: string[] = [];
  let run: { x: number; y: number }[] = [];
  let runSign = 1;
  const flush = () => {
    const a = run[0];
    const b = run[run.length - 1];
    if (a && b && run.length >= 2) {
      const d = [
        `M ${a.x.toFixed(1)},${y0.toFixed(1)}`,
        ...run.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `L ${b.x.toFixed(1)},${y0.toFixed(1)}`,
        "Z",
      ].join(" ");
      (runSign > 0 ? posPaths : negPaths).push(d);
    }
    run = [];
  };
  let prev: PnlPoint | null = null;
  for (const p of curve) {
    const sign = p.pnl >= 0 ? 1 : -1;
    if (prev && sign !== (prev.pnl >= 0 ? 1 : -1) && prev.pnl !== p.pnl) {
      const t = prev.pnl / (prev.pnl - p.pnl);
      const cx = X(prev.s + t * (p.s - prev.s));
      run.push({ x: cx, y: y0 });
      flush();
      run.push({ x: cx, y: y0 });
    }
    if (run.length === 0) runSign = sign;
    run.push({ x: X(p.s), y: Y(p.pnl) });
    prev = p;
  }
  flush();

  const linePts = curve.map((p) => `${X(p.s).toFixed(1)},${Y(p.pnl).toFixed(1)}`).join(" ");
  const visibleBes = bes.filter((b) => b >= sMin && b <= sMax);
  const yTicks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);
  const xTicks = [0, 1, 2, 3, 4].map((i) => sMin + ((sMax - sMin) * i) / 4);
  const ariaSummary = `Expiration P/L. Max profit ${fmtExtreme(maxProfit)}, max loss ${fmtExtreme(maxLoss)}, break-evens ${
    bes.map((b) => `$${fmtPrice(b, "")}`).join(", ") || "none"
  }.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaSummary}>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={ml} x2={W - mr} y1={Y(v)} y2={Y(v)} stroke="var(--color-nx-border)" strokeWidth="0.5" />
          <text x={ml - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-nx-muted)">
            {v >= 0 ? "+" : "−"}${fmtCompact(Math.abs(Math.round(v)))}
          </text>
        </g>
      ))}
      {xTicks.map((s) => (
        <text key={`x${s}`} x={X(s)} y={H - mb + 12} textAnchor="middle" fontSize="9" fill="var(--color-nx-muted)">
          {fmtNum(s, 0)}
        </text>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--color-nx-faint)">
        Underlying price at expiry
      </text>

      {posPaths.map((d) => (
        <path key={d} d={d} fill="var(--color-nx-up)" opacity="0.08" />
      ))}
      {negPaths.map((d) => (
        <path key={d} d={d} fill="var(--color-nx-down)" opacity="0.08" />
      ))}
      <line x1={ml} x2={W - mr} y1={y0} y2={y0} stroke="var(--color-nx-border-strong)" strokeWidth="0.75" />

      {maxProfit != null && (
        <g>
          <line x1={ml} x2={W - mr} y1={Y(maxProfit)} y2={Y(maxProfit)} stroke="var(--color-nx-up)" strokeWidth="0.75" strokeDasharray="4 3" />
          <text x={W - mr - 2} y={Y(maxProfit) - 3} textAnchor="end" fontSize="9" fill="var(--color-nx-up)">
            Max {fmtPnl(maxProfit)}
          </text>
        </g>
      )}
      {maxLoss != null && maxLoss !== 0 && (
        <g>
          <line x1={ml} x2={W - mr} y1={Y(maxLoss)} y2={Y(maxLoss)} stroke="var(--color-nx-down)" strokeWidth="0.75" strokeDasharray="4 3" />
          <text x={W - mr - 2} y={Y(maxLoss) + 10} textAnchor="end" fontSize="9" fill="var(--color-nx-down)">
            Max {fmtPnl(maxLoss)}
          </text>
        </g>
      )}

      <polyline points={linePts} fill="none" stroke="var(--color-nx-text-bright)" strokeWidth="1.25" />

      <line x1={X(spot)} x2={X(spot)} y1={mt} y2={mt + ih} stroke="var(--color-nx-amber)" strokeWidth="0.75" strokeDasharray="3 3" />
      <text x={X(spot) + 3} y={mt + 9} fontSize="9" fill="var(--color-nx-amber)">
        Spot ${fmtPrice(spot, "")}
      </text>

      {visibleBes.map((b) => (
        <g key={`be${b}`}>
          <circle cx={X(b)} cy={y0} r="2.5" fill="var(--color-nx-cyan)" />
          <text x={X(b)} y={y0 - 6} textAnchor="middle" fontSize="9" fill="var(--color-nx-cyan)">
            ${fmtPrice(b, "")}
          </text>
        </g>
      ))}
    </svg>
  );
}
