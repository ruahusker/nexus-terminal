// Massive (Polygon-style) aggregates adapter — server-side only, Bearer key.
// The key is on a low-rate plan, so all requests go through a module-scope
// promise-chain throttle enforcing >= 1.2s spacing between calls.

import type { Bar } from "../types";
import { ProviderError } from "./errors";

const BASE = "https://api.massive.com";
const MIN_SPACING_MS = 1_200;

type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";

const INTERVALS: Record<Interval, { mult: number; timespan: string }> = {
  "1m": { mult: 1, timespan: "minute" },
  "5m": { mult: 5, timespan: "minute" },
  "15m": { mult: 15, timespan: "minute" },
  "1h": { mult: 1, timespan: "hour" },
  "1d": { mult: 1, timespan: "day" },
  "1wk": { mult: 1, timespan: "week" },
};

// Module-scope throttle: each request queues behind the previous one and is
// delayed until at least MIN_SPACING_MS after the previous request started.
let throttleChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function throttle(): Promise<void> {
  const run = throttleChain.then(async () => {
    const wait = Math.max(0, MIN_SPACING_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  throttleChain = run.catch(() => {});
  return run;
}

interface AggResult {
  v?: number;
  o?: number;
  c?: number;
  h?: number;
  l?: number;
  t?: number;
}

interface AggsResponse {
  results?: AggResult[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchAggs(url: string): Promise<AggsResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.MASSIVE_API_KEY ?? ""}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt === 0) continue; // one retry on network/timeout
      throw err instanceof ProviderError
        ? err
        : new ProviderError(`Massive network error: ${String(err)}`, "upstream");
    }
    if (res.status === 429) {
      // No retry — the caller caches and can serve stale data instead.
      throw new ProviderError("Massive rate limit (429)", "rate_limit");
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(`Massive auth/plan error (HTTP ${res.status})`, "config");
    }
    if (!res.ok) {
      if (attempt === 0) continue; // one retry on other failures
      throw new ProviderError(`Massive HTTP ${res.status}`, "upstream");
    }
    return (await res.json()) as AggsResponse;
  }
  throw new ProviderError("Massive request failed", "upstream");
}

export const massive = {
  isConfigured(): boolean {
    return Boolean(process.env.MASSIVE_API_KEY);
  },

  async getBars(symbol: string, interval: Interval, rangeDays: number): Promise<Bar[]> {
    const spec = INTERVALS[interval];
    const to = new Date();
    const from = new Date(to.getTime() - rangeDays * 86_400_000);
    const url =
      `${BASE}/v2/aggs/ticker/${encodeURIComponent(symbol.toUpperCase())}` +
      `/range/${spec.mult}/${spec.timespan}/${ymd(from)}/${ymd(to)}` +
      `?adjusted=true&sort=asc&limit=50000`;
    const json = await fetchAggs(url);
    // `results` is absent on weekends/holidays — treat as empty.
    const results = json.results ?? [];
    return results.map((r) => ({
      time: Math.floor(num(r.t) / 1000), // ms epoch → unix seconds
      open: num(r.o),
      high: num(r.h),
      low: num(r.l),
      close: num(r.c),
      volume: num(r.v),
    }));
  },
};
