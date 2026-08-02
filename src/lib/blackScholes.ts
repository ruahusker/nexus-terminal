// Black-Scholes pricing, implied volatility, and Greeks.
// Used by the demo options engine and by strategy P/L calculations.

import type { Greeks } from "./types";

/** Standard normal CDF (Abramowitz-Stegun 7-term approximation, |ε| < 7.5e-8). */
export function normCdf(x: number): number {
  if (x <= -8) return 0;
  if (x >= 8) return 1;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

export function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp((-x * x) / 2);
}

export interface BSInput {
  spot: number;
  strike: number;
  timeYears: number; // time to expiry in years
  rate: number; // continuous risk-free, decimal
  vol: number; // implied vol, decimal
  type: "CALL" | "PUT";
}

export function bsPrice({ spot, strike, timeYears, rate, vol, type }: BSInput): number {
  if (timeYears <= 0 || vol <= 0) {
    return type === "CALL" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const { d1, d2 } = d1d2(spot, strike, timeYears, rate, vol);
  if (type === "CALL") {
    return spot * normCdf(d1) - strike * Math.exp(-rate * timeYears) * normCdf(d2);
  }
  return strike * Math.exp(-rate * timeYears) * normCdf(-d2) - spot * normCdf(-d1);
}

function d1d2(spot: number, strike: number, t: number, r: number, v: number) {
  const d1 = (Math.log(spot / strike) + (r + (v * v) / 2) * t) / (v * Math.sqrt(t));
  return { d1, d2: d1 - v * Math.sqrt(t) };
}

export function bsGreeks(input: BSInput): Greeks {
  const { spot, strike, timeYears: t, rate: r, vol: v, type } = input;
  if (t <= 0 || v <= 0) {
    const itm = type === "CALL" ? spot > strike : spot < strike;
    return { delta: itm ? (type === "CALL" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const { d1, d2 } = d1d2(spot, strike, t, r, v);
  const pdf = normPdf(d1);
  const gamma = pdf / (spot * v * Math.sqrt(t));
  const vega = (spot * pdf * Math.sqrt(t)) / 100; // per 1 vol point
  if (type === "CALL") {
    return {
      delta: normCdf(d1),
      gamma,
      theta: (-(spot * pdf * v) / (2 * Math.sqrt(t)) - r * strike * Math.exp(-r * t) * normCdf(d2)) / 365,
      vega,
      rho: (strike * t * Math.exp(-r * t) * normCdf(d2)) / 100,
    };
  }
  return {
    delta: normCdf(d1) - 1,
    gamma,
    theta: (-(spot * pdf * v) / (2 * Math.sqrt(t)) + r * strike * Math.exp(-r * t) * normCdf(-d2)) / 365,
    vega,
    rho: (-strike * t * Math.exp(-r * t) * normCdf(-d2)) / 100,
  };
}

/** Implied vol via bisection on monotone BS price. Returns null if no solution in (1e-4, 5). */
export function impliedVol(marketPrice: number, input: Omit<BSInput, "vol">, tol = 1e-5): number | null {
  const intrinsic =
    input.type === "CALL"
      ? Math.max(0, input.spot - input.strike * Math.exp(-input.rate * input.timeYears))
      : Math.max(0, input.strike * Math.exp(-input.rate * input.timeYears) - input.spot);
  if (marketPrice <= intrinsic || input.timeYears <= 0) return null;
  let lo = 1e-4;
  let hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice({ ...input, vol: mid });
    if (Math.abs(price - marketPrice) < tol) return mid;
    if (price < marketPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Log-normal probability that spot finishes above `target` at expiry. */
export function probAbove(spot: number, target: number, timeYears: number, rate: number, vol: number): number {
  if (timeYears <= 0 || vol <= 0) return spot >= target ? 1 : 0;
  const d2 = (Math.log(spot / target) + (rate - (vol * vol) / 2) * timeYears) / (vol * Math.sqrt(timeYears));
  return normCdf(d2);
}

/** 1-sigma expected move: S · σ · √t */
export function expectedMove(spot: number, vol: number, timeYears: number): number {
  return spot * vol * Math.sqrt(Math.max(0, timeYears));
}
