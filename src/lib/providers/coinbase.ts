// Coinbase adapter — public APIs, no API key required.
// Spot price comes from api.coinbase.com; candles from api.exchange.coinbase.com
// (returned newest-first, max 300 points per request).

import type { Bar, Quote } from "../types";
import { ProviderError } from "./errors";

const SPOT_BASE = "https://api.coinbase.com/v2";
const EXCHANGE_BASE = "https://api.exchange.coinbase.com";

type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";

// The candles endpoint returns at most 300 points per request, so the
// requested span is capped at 300 × granularity:
//   1m → last ~5h, 5m → ~25h, 15m → ~3d, 1h → ~12d, 1d → 300d.
const GRANULARITY: Record<Exclude<Interval, "1wk">, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
};
const MAX_POINTS = 300;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      if (attempt === 0) continue; // one retry on network/timeout
      throw new ProviderError(`Coinbase network error: ${String(err)}`, "upstream");
    }
    if (res.status === 404) {
      throw new ProviderError(`Coinbase: unknown pair (HTTP 404)`, "not_found");
    }
    if (res.status === 429) {
      throw new ProviderError("Coinbase rate limit (429)", "rate_limit");
    }
    if (res.status >= 500) {
      if (attempt === 0) continue; // one retry on 5xx
      throw new ProviderError(`Coinbase HTTP ${res.status}`, "upstream");
    }
    if (!res.ok) {
      throw new ProviderError(`Coinbase HTTP ${res.status}`, "upstream");
    }
    return res.json();
  }
  throw new ProviderError("Coinbase request failed", "upstream");
}

// Coinbase candles: [time (unix sec), low, high, open, close, volume], DESC order.
type RawCandle = [number, number, number, number, number, number];

async function fetchCandles(symbol: string, granularitySec: number, rangeDays: number): Promise<Bar[]> {
  const end = new Date();
  const spanSec = Math.min(rangeDays * 86_400, MAX_POINTS * granularitySec);
  const start = new Date(end.getTime() - spanSec * 1000);
  const url =
    `${EXCHANGE_BASE}/products/${encodeURIComponent(symbol.toUpperCase())}-USD/candles` +
    `?granularity=${granularitySec}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const json = (await fetchJson(url)) as RawCandle[];
  if (!Array.isArray(json)) throw new ProviderError(`Coinbase: unexpected candles payload for ${symbol}`, "upstream");
  return json
    .filter((c): c is RawCandle => Array.isArray(c) && c.length >= 6)
    .map((c) => ({
      time: Math.floor(num(c[0])),
      low: num(c[1]),
      high: num(c[2]),
      open: num(c[3]),
      close: num(c[4]),
      volume: num(c[5]),
    }))
    .sort((a, b) => a.time - b.time); // API returns DESC — sort ascending
}

// Aggregate daily bars into weekly bars (week starts at unix-week boundary, UTC).
function toWeekly(daily: Bar[]): Bar[] {
  const weeks = new Map<number, Bar>();
  for (const b of daily) {
    const wk = b.time - (b.time % (7 * 86_400));
    const existing = weeks.get(wk);
    if (!existing) {
      weeks.set(wk, { time: wk, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    } else {
      existing.high = Math.max(existing.high, b.high);
      existing.low = Math.min(existing.low, b.low);
      existing.close = b.close;
      existing.volume += b.volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}

export const coinbase = {
  isConfigured(): true {
    return true; // public API — always configured
  },

  async getQuote(symbol: string): Promise<Quote> {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const spotJson = (await fetchJson(`${SPOT_BASE}/prices/${sym}-USD/spot`)) as {
      data?: { amount?: string };
    };
    const price = num(spotJson.data?.amount);
    if (!price) throw new ProviderError(`Coinbase: no spot price for ${symbol}`, "not_found");

    // Daily candles (300) supply open/high/low/prevClose/volume/avgVolume/week52.
    const daily = await fetchCandles(symbol, GRANULARITY["1d"], 300);
    const today = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const volumes = daily.map((b) => b.volume);
    const avgVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
    const prevClose = prev?.close ?? today?.open ?? price;
    const change = price - prevClose;

    return {
      provider: "coinbase",
      status: "REALTIME",
      asOf: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      price,
      change,
      changePct: prevClose ? change / prevClose : 0, // decimal
      bid: price,
      ask: price, // spot endpoint has no bid/ask
      open: today?.open ?? price,
      high: today?.high ?? price,
      low: today?.low ?? price,
      prevClose,
      volume: today?.volume ?? 0,
      avgVolume,
      week52High: daily.length ? Math.max(...daily.map((b) => b.high)) : 0,
      week52Low: daily.length ? Math.min(...daily.map((b) => b.low)) : 0,
      marketState: "ALWAYS",
    };
  },

  async getBars(symbol: string, interval: Interval, rangeDays: number): Promise<Bar[]> {
    if (interval === "1wk") {
      // No native weekly granularity — fetch daily and aggregate client-side.
      const daily = await fetchCandles(symbol, GRANULARITY["1d"], rangeDays);
      return toWeekly(daily);
    }
    return fetchCandles(symbol, GRANULARITY[interval], rangeDays);
  },
};
