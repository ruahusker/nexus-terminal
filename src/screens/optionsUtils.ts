// Pure options-strategy math for the Options screen.
// No React, no fetch — every function here is unit-testable in isolation.

import { probAbove } from "@/lib/blackScholes";
import type { OptionContract, OptionsChain } from "@/lib/types";

export const OPTION_MULTIPLIER = 100;
/** Matches the demo chain engine's risk-free rate. */
export const RISK_FREE_RATE = 0.043;

// ─── Legs ───────────────────────────────────────────────────────────────────

export interface StrategyLeg {
  id: string;
  kind: "OPTION" | "STOCK";
  side: "BUY" | "SELL";
  qty: number; // contracts for options, shares for STOCK legs
  contract: OptionContract | null; // null for STOCK legs
  price: number; // per share: option mid, or share price for STOCK legs
}

let legCounter = 0;
function nextLegId(): string {
  legCounter += 1;
  return `leg-${Date.now().toString(36)}-${legCounter}`;
}

export function makeOptionLeg(contract: OptionContract, side: "BUY" | "SELL" = "BUY", qty = 1): StrategyLeg {
  return { id: nextLegId(), kind: "OPTION", side, qty, contract, price: contract.mid };
}

export function makeStockLeg(price: number, side: "BUY" | "SELL" = "BUY", qty = 100): StrategyLeg {
  return { id: nextLegId(), kind: "STOCK", side, qty, contract: null, price };
}

export function legDescription(leg: StrategyLeg): string {
  const c = leg.contract;
  if (!c) return "Underlying shares";
  return `${c.type === "CALL" ? "C" : "P"} ${c.strike} ${c.expiry}`;
}

function legDir(leg: StrategyLeg): number {
  return leg.side === "BUY" ? 1 : -1;
}

// ─── Time ───────────────────────────────────────────────────────────────────

/** Years to expiry (ACT/365, expiry at 16:00 UTC), floored at 1 day. Matches the chain engine. */
export function timeToExpiryYears(expiry: string): number {
  const ms = new Date(`${expiry}T16:00:00Z`).getTime() - Date.now();
  return Math.max(1 / 365, ms / (365 * 86_400_000));
}

// ─── Expiration P/L ─────────────────────────────────────────────────────────

/** Total strategy P/L in dollars if the underlying settles at `s` at expiry. */
export function pnlAt(legs: StrategyLeg[], s: number): number {
  let pnl = 0;
  for (const leg of legs) {
    const dir = legDir(leg);
    const c = leg.contract;
    if (leg.kind === "OPTION" && c) {
      const intrinsic = c.type === "CALL" ? Math.max(0, s - c.strike) : Math.max(0, c.strike - s);
      pnl += dir * leg.qty * OPTION_MULTIPLIER * (intrinsic - leg.price);
    } else {
      pnl += dir * leg.qty * (s - leg.price);
    }
  }
  return pnl;
}

export interface PnlPoint {
  s: number;
  pnl: number;
}

/** Dense P/L curve over ±range around spot. */
export function pnlCurve(legs: StrategyLeg[], spot: number, points = 121, range = 0.3): PnlPoint[] {
  const out: PnlPoint[] = [];
  const lo = spot * (1 - range);
  const hi = spot * (1 + range);
  for (let i = 0; i < points; i++) {
    const s = lo + ((hi - lo) * i) / (points - 1);
    out.push({ s, pnl: pnlAt(legs, s) });
  }
  return out;
}

/**
 * Exact break-evens: expiry P/L is piecewise linear with kinks only at strikes,
 * so scanning the kink points (plus the S=0 floor and a far tail) and
 * interpolating sign changes finds every root.
 */
export function breakEvens(legs: StrategyLeg[], spot: number): number[] {
  const kinks = new Set<number>([0, spot * 3]);
  for (const leg of legs) if (leg.contract) kinks.add(leg.contract.strike);
  const xs = [...kinks].sort((a, b) => a - b);
  const roots: number[] = [];
  let prevS: number | null = null;
  let prevPnl = 0;
  for (const s of xs) {
    const pnl = pnlAt(legs, s);
    if (Math.abs(pnl) < 1e-9) {
      if (roots.length === 0 || Math.abs((roots[roots.length - 1] ?? 0) - s) > 1e-6) roots.push(s);
    } else if (prevS !== null && prevPnl * pnl < 0) {
      const t = prevPnl / (prevPnl - pnl);
      roots.push(prevS + t * (s - prevS));
    }
    prevS = s;
    prevPnl = pnl;
  }
  return roots;
}

/** Slope of P/L ($ per $1 of underlying) beyond the outermost strike. */
function wingSlope(legs: StrategyLeg[], wing: "below" | "above"): number {
  let slope = 0;
  for (const leg of legs) {
    const dir = legDir(leg);
    const c = leg.contract;
    if (leg.kind === "OPTION" && c) {
      if (wing === "above" && c.type === "CALL") slope += dir * leg.qty * OPTION_MULTIPLIER;
      if (wing === "below" && c.type === "PUT") slope -= dir * leg.qty * OPTION_MULTIPLIER;
    } else {
      slope += dir * leg.qty;
    }
  }
  return slope;
}

export interface ProfitLoss {
  /** null = unbounded above (e.g. naked short call → unbounded loss). */
  maxProfit: number | null;
  maxLoss: number | null;
}

/**
 * Max profit / max loss. Below the lowest strike the underlying floors at S=0,
 * so that wing is always bounded; above the highest strike a nonzero slope
 * means the P/L is unbounded in that direction.
 */
export function maxProfitLoss(legs: StrategyLeg[], spot: number): ProfitLoss {
  if (legs.length === 0) return { maxProfit: 0, maxLoss: 0 };
  const strikes = legs.map((l) => l.contract?.strike).filter((k): k is number => k != null);
  const hi = Math.max(spot, ...strikes);
  const candidates = [0, hi + spot, ...strikes];
  let max = -Infinity;
  let min = Infinity;
  for (const s of candidates) {
    const pnl = pnlAt(legs, s);
    if (pnl > max) max = pnl;
    if (pnl < min) min = pnl;
  }
  const slope = wingSlope(legs, "above");
  return {
    maxProfit: slope > 1e-9 ? null : max,
    maxLoss: slope < -1e-9 ? null : min,
  };
}

/** Net premium in dollars. Positive = net debit (cash paid), negative = net credit. */
export function netPremium(legs: StrategyLeg[]): number {
  let net = 0;
  for (const leg of legs) {
    const dir = legDir(leg);
    const mult = leg.kind === "OPTION" ? OPTION_MULTIPLIER : 1;
    net += dir * leg.qty * mult * leg.price;
  }
  return net;
}

export interface PositionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/** Net position greeks (option greeks × 100 multiplier; stock carries delta only). */
export function positionGreeks(legs: StrategyLeg[]): PositionGreeks {
  const g: PositionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const dir = legDir(leg);
    const c = leg.contract;
    if (leg.kind === "OPTION" && c) {
      g.delta += dir * leg.qty * OPTION_MULTIPLIER * c.delta;
      g.gamma += dir * leg.qty * OPTION_MULTIPLIER * c.gamma;
      g.theta += dir * leg.qty * OPTION_MULTIPLIER * c.theta;
      g.vega += dir * leg.qty * OPTION_MULTIPLIER * c.vega;
    } else {
      g.delta += dir * leg.qty;
    }
  }
  return g;
}

/**
 * Probability the strategy is profitable at expiry, under the log-normal model.
 * Splits the price axis at the break-evens and sums the probability mass of
 * the profitable intervals via probAbove().
 */
export function probOfProfit(
  legs: StrategyLeg[],
  spot: number,
  breakEvents: number[],
  timeYears: number,
  vol: number,
  rate = RISK_FREE_RATE,
): number | null {
  if (legs.length === 0 || vol <= 0 || timeYears <= 0) return null;
  const bounds = [...breakEvents].sort((a, b) => a - b);
  const edges = [0, ...bounds, Infinity];
  let prob = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i] ?? 0;
    const hi = edges[i + 1] ?? Infinity;
    const mid = hi === Infinity ? Math.max(lo * 1.2, lo + spot * 0.05) : lo === 0 ? hi / 2 : (lo + hi) / 2;
    if (pnlAt(legs, mid) <= 0) continue;
    const pLo = lo <= 0 ? 1 : probAbove(spot, lo, timeYears, rate, vol);
    const pHi = hi === Infinity ? 0 : probAbove(spot, hi, timeYears, rate, vol);
    prob += Math.max(0, pLo - pHi);
  }
  return Math.min(1, Math.max(0, prob));
}

// ─── Chain helpers ──────────────────────────────────────────────────────────

/** Contract of `type` whose delta is nearest `targetDelta`, skipping taken strikes. */
export function nearestDelta(
  contracts: OptionContract[],
  type: "CALL" | "PUT",
  targetDelta: number,
  taken?: Set<string>,
): OptionContract | null {
  let best: OptionContract | null = null;
  for (const c of contracts) {
    if (c.type !== type || taken?.has(`${c.type}:${c.strike}`)) continue;
    if (!best || Math.abs(c.delta - targetDelta) < Math.abs(best.delta - targetDelta)) best = c;
  }
  return best;
}

/** Contract of `type` whose strike is nearest the underlying price. */
export function atmContract(contracts: OptionContract[], type: "CALL" | "PUT", spot: number): OptionContract | null {
  let best: OptionContract | null = null;
  for (const c of contracts) {
    if (c.type !== type) continue;
    if (!best || Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) best = c;
  }
  return best;
}

/** Mean IV of the ATM call and put, or null if the chain is empty. */
export function atmIv(chain: OptionsChain): number | null {
  const call = atmContract(chain.contracts, "CALL", chain.underlyingPrice);
  const put = atmContract(chain.contracts, "PUT", chain.underlyingPrice);
  const ivs = [call?.iv, put?.iv].filter((v): v is number => v != null && v > 0);
  if (ivs.length === 0) return null;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

export interface SkewRead {
  putIv: number;
  callIv: number;
  /** putIv − callIv, in vol points. Positive = downside puts richer. */
  diffPts: number;
}

/** IV of the ~25-delta put vs the ~25-delta call. */
export function skew25(chain: OptionsChain): SkewRead | null {
  const put = nearestDelta(chain.contracts, "PUT", -0.25);
  const call = nearestDelta(chain.contracts, "CALL", 0.25);
  if (!put || !call) return null;
  return { putIv: put.iv, callIv: call.iv, diffPts: (put.iv - call.iv) * 100 };
}

// ─── Strategy templates ─────────────────────────────────────────────────────

export type TemplateId =
  | "covered-call"
  | "cash-secured-put"
  | "bull-call"
  | "bear-put"
  | "straddle"
  | "strangle"
  | "iron-condor";

export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: "covered-call", name: "Covered Call", blurb: "Long 100 shares + short ~0.30Δ call" },
  { id: "cash-secured-put", name: "Cash-Secured Put", blurb: "Short ~0.30Δ put" },
  { id: "bull-call", name: "Bull Call Spread", blurb: "Buy ~0.55Δ call, sell ~0.30Δ call" },
  { id: "bear-put", name: "Bear Put Spread", blurb: "Buy ~−0.55Δ put, sell ~−0.30Δ put" },
  { id: "straddle", name: "Long Straddle", blurb: "Buy ATM call + ATM put" },
  { id: "strangle", name: "Long Strangle", blurb: "Buy ~0.25Δ call + ~−0.25Δ put" },
  { id: "iron-condor", name: "Iron Condor", blurb: "Sell ~0.20Δ wings, buy ~0.10Δ wings" },
];

/**
 * Auto-build template legs from the current chain by delta targeting.
 * Deltas are monotonic in strike, so distinct delta targets land on correctly
 * ordered strikes; the `taken` set guards against collisions on coarse chains.
 * Returns null if the chain cannot supply every leg.
 */
export function buildTemplate(id: TemplateId, chain: OptionsChain): StrategyLeg[] | null {
  const { contracts, underlyingPrice: spot } = chain;
  const taken = new Set<string>();
  const pick = (type: "CALL" | "PUT", delta: number): OptionContract | null => {
    const c = nearestDelta(contracts, type, delta, taken);
    if (c) taken.add(`${c.type}:${c.strike}`);
    return c;
  };

  switch (id) {
    case "covered-call": {
      const call = pick("CALL", 0.3);
      return call ? [makeStockLeg(spot, "BUY", 100), makeOptionLeg(call, "SELL", 1)] : null;
    }
    case "cash-secured-put": {
      const put = pick("PUT", -0.3);
      return put ? [makeOptionLeg(put, "SELL", 1)] : null;
    }
    case "bull-call": {
      const long = pick("CALL", 0.55);
      const short = pick("CALL", 0.3);
      return long && short ? [makeOptionLeg(long, "BUY", 1), makeOptionLeg(short, "SELL", 1)] : null;
    }
    case "bear-put": {
      const long = pick("PUT", -0.55);
      const short = pick("PUT", -0.3);
      return long && short ? [makeOptionLeg(long, "BUY", 1), makeOptionLeg(short, "SELL", 1)] : null;
    }
    case "straddle": {
      const call = atmContract(contracts, "CALL", spot);
      const put = atmContract(contracts, "PUT", spot);
      return call && put ? [makeOptionLeg(call, "BUY", 1), makeOptionLeg(put, "BUY", 1)] : null;
    }
    case "strangle": {
      const put = pick("PUT", -0.25);
      const call = pick("CALL", 0.25);
      return put && call ? [makeOptionLeg(put, "BUY", 1), makeOptionLeg(call, "BUY", 1)] : null;
    }
    case "iron-condor": {
      const shortPut = pick("PUT", -0.2);
      const longPut = pick("PUT", -0.1);
      const shortCall = pick("CALL", 0.2);
      const longCall = pick("CALL", 0.1);
      return shortPut && longPut && shortCall && longCall
        ? [
            makeOptionLeg(longPut, "BUY", 1),
            makeOptionLeg(shortPut, "SELL", 1),
            makeOptionLeg(shortCall, "SELL", 1),
            makeOptionLeg(longCall, "BUY", 1),
          ]
        : null;
    }
  }
}

// ─── CSV export ─────────────────────────────────────────────────────────────

export function chainCsv(chain: OptionsChain): string {
  const rows = ["side,strike,bid,ask,mid,last,volume,oi,iv,delta,gamma,theta,vega,rho"];
  const sorted = [...chain.contracts].sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));
  for (const c of sorted) {
    rows.push(
      [
        c.type,
        c.strike,
        c.bid.toFixed(2),
        c.ask.toFixed(2),
        c.mid.toFixed(2),
        c.last.toFixed(2),
        c.volume,
        c.openInterest,
        c.iv.toFixed(4),
        c.delta.toFixed(4),
        c.gamma.toFixed(4),
        c.theta.toFixed(4),
        c.vega.toFixed(4),
        c.rho.toFixed(4),
      ].join(","),
    );
  }
  return rows.join("\n");
}

export function strategyCsv(legs: StrategyLeg[], summary: [string, string][]): string {
  const rows = ["section,kind,side,qty,strike,expiry,type,price,delta"];
  for (const leg of legs) {
    const c = leg.contract;
    rows.push(
      [
        "leg",
        leg.kind,
        leg.side,
        leg.qty,
        c ? c.strike : "",
        c ? c.expiry : "",
        c ? c.type : "",
        leg.price.toFixed(2),
        c ? c.delta.toFixed(4) : "1",
      ].join(","),
    );
  }
  rows.push("");
  rows.push("metric,value");
  for (const [k, v] of summary) rows.push(`"${k}","${v}"`);
  return rows.join("\n");
}
