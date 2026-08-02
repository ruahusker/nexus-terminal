import { describe, expect, it } from "vitest";
import { hashString, mulberry32, seededRng, gaussian } from "@/lib/rng";
import { fmtPct, fmtPrice, fmtCompact, fmtSigned, dirGlyph } from "@/lib/format";
import { sma, ema, rsi, macd, bollinger, annualizedVol, maxDrawdown, valueAtRisk } from "@/lib/indicators";
import { bsPrice, bsGreeks, impliedVol, probAbove, expectedMove, normCdf } from "@/lib/blackScholes";

describe("rng determinism", () => {
  it("same seed produces same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("hashString is stable", () => {
    expect(hashString("AAPL")).toBe(hashString("AAPL"));
    expect(hashString("AAPL")).not.toBe(hashString("MSFT"));
  });
  it("gaussian is roughly standard normal", () => {
    const rng = seededRng("norm-test");
    const samples = Array.from({ length: 5000 }, () => gaussian(rng));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });
});

describe("format", () => {
  it("formats prices with sensible precision", () => {
    expect(fmtPrice(1234.5)).toBe("1,234.50");
    expect(fmtPrice(0.32)).toBe("0.3200");
    expect(fmtPrice(null)).toBe("—");
  });
  it("formats signed percents", () => {
    expect(fmtPct(0.0123)).toBe("+1.23%");
    expect(fmtPct(-0.045)).toBe("−4.50%");
    expect(fmtPct(null)).toBe("—");
  });
  it("formats compact numbers", () => {
    expect(fmtCompact(1.5e9)).toBe("1.50B");
    expect(fmtCompact(2_500_000)).toBe("2.50M");
  });
  it("signed values keep explicit sign", () => {
    expect(fmtSigned(5)).toBe("+5.00");
    expect(fmtSigned(-5)).toBe("−5.00");
  });
  it("direction glyphs for non-color signaling", () => {
    expect(dirGlyph(1)).toBe("▲");
    expect(dirGlyph(-1)).toBe("▼");
    expect(dirGlyph(0)).toBe(" ");
  });
});

describe("indicators", () => {
  const flat = Array(30).fill(10) as number[];
  const rising = Array.from({ length: 60 }, (_, i) => 100 + i);

  it("sma computes windowed mean", () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    expect(r[2]).toBe(2);
    expect(r[4]).toBe(4);
    expect(r[0]).toBeNull();
  });
  it("ema converges to flat series value", () => {
    const r = ema(flat, 10);
    expect(r[29]).toBeCloseTo(10, 5);
  });
  it("rsi is 100 on a strictly rising series", () => {
    const r = rsi(rising, 14);
    expect(r[59]).toBeCloseTo(100, 5);
  });
  it("macd histogram is macd minus signal", () => {
    const { macd: m, signal, histogram } = macd(rising);
    const i = 59;
    expect(histogram[i]).toBeCloseTo((m[i] as number) - (signal[i] as number), 8);
  });
  it("bollinger bands bracket the middle", () => {
    const { upper, middle, lower } = bollinger(rising, 20, 2);
    const i = 30;
    expect(upper[i]).toBeGreaterThan(middle[i] as number);
    expect(lower[i]).toBeLessThan(middle[i] as number);
  });
  it("vol/drawdown/var sanity", () => {
    expect(annualizedVol(flat)).toBe(0);
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(0.5, 5);
    const rets = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.011));
    const v = valueAtRisk(rets, 0.95);
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThan(0);
  });
});

describe("black-scholes", () => {
  const base = { spot: 100, strike: 100, timeYears: 0.5, rate: 0.05, vol: 0.25 };

  it("normCdf bounds", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(-8)).toBe(0);
  });
  it("put-call parity holds", () => {
    const call = bsPrice({ ...base, type: "CALL" });
    const put = bsPrice({ ...base, type: "PUT" });
    const lhs = call - put;
    const rhs = base.spot - base.strike * Math.exp(-base.rate * base.timeYears);
    expect(lhs).toBeCloseTo(rhs, 6);
  });
  it("greeks signs are correct", () => {
    const c = bsGreeks({ ...base, type: "CALL" });
    const p = bsGreeks({ ...base, type: "PUT" });
    expect(c.delta).toBeGreaterThan(0);
    expect(p.delta).toBeLessThan(0);
    expect(c.gamma).toBeGreaterThan(0);
    expect(c.vega).toBeGreaterThan(0);
    expect(c.theta).toBeLessThan(0);
  });
  it("implied vol round-trips the price", () => {
    const price = bsPrice({ ...base, type: "CALL" });
    const iv = impliedVol(price, { ...base, type: "CALL" });
    expect(iv).not.toBeNull();
    expect(iv as number).toBeCloseTo(base.vol, 3);
  });
  it("probabilities and expected move", () => {
    expect(probAbove(100, 100, 0.5, 0, 0.25)).toBeCloseTo(0.5, 1);
    expect(probAbove(100, 50, 1, 0, 0.2)).toBeGreaterThan(0.99);
    expect(expectedMove(100, 0.2, 1)).toBeCloseTo(20, 6);
  });
});
