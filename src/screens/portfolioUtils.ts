// Pure portfolio computations — no React, no fetch. Client-safe.

import { annualizedVol, maxDrawdown, valueAtRisk } from "@/lib/indicators";

export type PositionAssetClass = "STOCK" | "ETF" | "CRYPTO" | "OPTION";
export type TxSide = "BUY" | "SELL" | "DIVIDEND" | "PREMIUM" | "DEPOSIT" | "WITHDRAWAL";

export interface Position {
  id: string;
  portfolioId: string;
  symbol: string;
  assetClass: PositionAssetClass;
  quantity: number;
  avgCost: number;
  openedAt: string;
  optionType?: "CALL" | "PUT" | null;
  strike?: number | null;
  expiry?: string | null;
}

export interface Transaction {
  id: string;
  portfolioId: string;
  symbol: string;
  side: TxSide;
  quantity: number;
  price: number;
  fees: number;
  executedAt: string;
  note: string | null;
}

export interface Portfolio {
  id: string;
  name: string;
  cash: number;
  createdAt: string;
  updatedAt: string;
  positions: Position[];
  transactions: Transaction[];
}

/** Mirrors the server-side symbolSchema in src/lib/api.ts. */
export const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,12}$/;

export const CSV_TEMPLATE = [
  "symbol,side,quantity,price,date,fees,note",
  "AAPL,BUY,10,150.25,2024-01-15,0,initial position",
  "MSFT,BUY,5,420.10,2024-02-01,1.50,add to winner",
].join("\n");

export interface Mark {
  price: number;
  prevClose: number;
  live: boolean; // false = fallback mark (options, or quote unavailable)
}

/** Options are marked at cost (live option marks unavailable); missing quotes fall back to cost too. */
export function markFor(p: Position, quote: { price: number; prevClose: number } | undefined): Mark {
  if (p.assetClass !== "OPTION" && quote) return { price: quote.price, prevClose: quote.prevClose, live: true };
  return { price: p.avgCost, prevClose: p.avgCost, live: false };
}

export interface PositionRow {
  position: Position;
  mark: Mark;
  mktValue: number;
  dayPL: number;
  unrealPL: number;
  unrealPct: number | null;
}

export function positionRows(positions: Position[], quotes: Map<string, { price: number; prevClose: number }>): PositionRow[] {
  return positions.map((p) => {
    const mark = markFor(p, quotes.get(p.symbol));
    const mktValue = p.quantity * mark.price;
    return {
      position: p,
      mark,
      mktValue,
      dayPL: mark.live ? p.quantity * (mark.price - mark.prevClose) : 0,
      unrealPL: p.quantity * (mark.price - p.avgCost),
      unrealPct: p.avgCost > 0 ? (mark.price - p.avgCost) / p.avgCost : null,
    };
  });
}

export interface PortfolioSummary {
  invested: number;
  costBasis: number;
  cash: number;
  total: number;
  dayPL: number;
  unrealPL: number;
  unrealPct: number | null;
}

export function summarize(rows: PositionRow[], cash: number): PortfolioSummary {
  const invested = rows.reduce((a, r) => a + r.mktValue, 0);
  const costBasis = rows.reduce((a, r) => a + r.position.quantity * r.position.avgCost, 0);
  const dayPL = rows.reduce((a, r) => a + r.dayPL, 0);
  const unrealPL = rows.reduce((a, r) => a + r.unrealPL, 0);
  return {
    invested,
    costBasis,
    cash,
    total: invested + cash,
    dayPL,
    unrealPL,
    unrealPct: costBasis > 0 ? unrealPL / costBasis : null,
  };
}

export interface AllocSlice {
  label: string;
  value: number;
  weight: number; // fraction of invested (positions-only) value
}

/** Group position rows by a key into value-weighted slices, sorted desc. */
export function allocation(rows: PositionRow[], key: (p: Position) => string): AllocSlice[] {
  const total = rows.reduce((a, r) => a + r.mktValue, 0);
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r.position);
    map.set(k, (map.get(k) ?? 0) + r.mktValue);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value, weight: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export interface Concentration {
  top5Weight: number;
  largestSymbol: string | null;
  largestWeight: number;
  hhi: number; // Herfindahl-Hirschman index of position weights (0–1)
}

export function concentration(rows: PositionRow[]): Concentration {
  const total = rows.reduce((a, r) => a + r.mktValue, 0);
  if (total <= 0 || rows.length === 0) return { top5Weight: 0, largestSymbol: null, largestWeight: 0, hhi: 0 };
  const bySym = new Map<string, number>();
  for (const r of rows) bySym.set(r.position.symbol, (bySym.get(r.position.symbol) ?? 0) + r.mktValue);
  const entries = [...bySym.entries()].sort((a, b) => b[1] - a[1]);
  const weights = entries.map(([, v]) => v / total);
  const top = entries[0];
  return {
    top5Weight: weights.slice(0, 5).reduce((a, w) => a + w, 0),
    largestSymbol: top ? top[0] : null,
    largestWeight: weights[0] ?? 0,
    hhi: weights.reduce((a, w) => a + w * w, 0),
  };
}

/**
 * Weighted portfolio equity index from per-symbol daily closes.
 * Each series is rebased to 1.0 at the common start date; weights are
 * renormalized over the included symbols. Length = min(series lengths, maxPoints).
 */
export function buildEquityCurve(series: { weight: number; closes: number[] }[], maxPoints = 120): number[] {
  const usable = series.filter((s) => s.weight > 0 && s.closes.length >= 2);
  if (usable.length === 0) return [];
  const wSum = usable.reduce((a, s) => a + s.weight, 0);
  const n = Math.min(maxPoints, ...usable.map((s) => s.closes.length));
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    let v = 0;
    for (const s of usable) {
      const base = s.closes[s.closes.length - n] as number;
      const c = s.closes[s.closes.length - n + t] as number;
      if (base > 0) v += (s.weight / wSum) * (c / base);
    }
    out.push(v);
  }
  return out;
}

export function simpleReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] as number;
    const b = values[i] as number;
    if (a > 0 && b > 0) out.push(b / a - 1);
  }
  return out;
}

export interface RiskStats {
  points: number;
  vol: number | null; // annualized, fraction
  maxDD: number | null; // positive fraction
  var95: number | null; // 1-day 95% VaR, positive fraction
}

/** Needs >= 30 curve points; otherwise every metric is null ("insufficient data"). */
export function riskStats(curve: number[]): RiskStats {
  if (curve.length < 30) return { points: curve.length, vol: null, maxDD: null, var95: null };
  return {
    points: curve.length,
    vol: annualizedVol(curve),
    maxDD: maxDrawdown(curve),
    var95: valueAtRisk(simpleReturns(curve), 0.95),
  };
}

export type ScenarioKind = "market" | "crypto" | "custom";

export interface ScenarioImpactRow {
  symbol: string;
  assetClass: PositionAssetClass;
  value: number;
  shockPct: number; // signed fraction actually applied (after beta)
  pl: number;
}

/**
 * Instantaneous shock P/L per position.
 *  - market: STOCK/ETF shocked by pct × beta (beta = 1 when unknown)
 *  - crypto: CRYPTO shocked by pct
 *  - custom: pct applied to all equity (STOCK/ETF) positions
 * OPTION positions are excluded (marked at cost — no live greeks).
 */
export function scenarioImpact(
  rows: PositionRow[],
  kind: ScenarioKind,
  pct: number,
  betaOf: (symbol: string) => number | null,
): ScenarioImpactRow[] {
  const out: ScenarioImpactRow[] = [];
  for (const r of rows) {
    const ac = r.position.assetClass;
    let shock: number | null = null;
    if (kind === "crypto") {
      shock = ac === "CRYPTO" ? pct : null;
    } else if (ac === "STOCK" || ac === "ETF") {
      shock = kind === "market" ? pct * (betaOf(r.position.symbol) ?? 1) : pct;
    }
    if (shock == null) continue;
    out.push({ symbol: r.position.symbol, assetClass: ac, value: r.mktValue, shockPct: shock, pl: r.mktValue * shock });
  }
  return out.sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl));
}

export function incomeTotals(txns: Transaction[]): { dividends: number; premiums: number } {
  let dividends = 0;
  let premiums = 0;
  for (const t of txns) {
    if (t.side === "DIVIDEND") dividends += t.quantity * t.price;
    else if (t.side === "PREMIUM") premiums += t.quantity * t.price;
  }
  return { dividends, premiums };
}

/** Whole days from now until the given ISO date (negative = past). */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export interface CalEvent {
  date: string;
  days: number;
  kind: "OPTION_EXPIRY" | "EARNINGS";
  label: string;
}
