// Yahoo Finance adapter — keyless, unofficial v8 chart API.
// Symbols must be in Yahoo form; use toYahooSymbol() to map app symbols.

import type { Bar, OptionContract, OptionsChain, Quote } from "../types";
import { bsGreeks, expectedMove } from "../blackScholes";
import { ProviderError } from "./errors";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) NEXUS-Terminal/1.0";

type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";
type AppRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "MAX";

const RANGES: Record<AppRange, string> = {
  "1D": "1d",
  "5D": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "6M": "6mo",
  "1Y": "1y",
  "2Y": "2y",
  "5Y": "5y",
  MAX: "max",
};

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EURUSD=X",
  SPX: "^GSPC",
  NDX: "^NDX",
  DJI: "^DJI",
  RUT: "^RUT",
  VIX: "^VIX",
  FTSE: "^FTSE",
  DAX: "^GDAXI",
  N225: "^N225",
  HSI: "^HSI",
  DXY: "DX-Y.NYB",
  IRX: "^IRX", // 13-week T-bill yield
  FVX: "^FVX", // 5-year treasury yield (×10)
  TNX: "^TNX", // 10-year treasury yield (×10)
  TYX: "^TYX", // 30-year treasury yield (×10)
  CL: "CL=F",
  NG: "NG=F",
  GC: "GC=F",
  SI: "SI=F",
  HG: "HG=F",
  ZW: "ZW=F",
};

/** Map an app symbol to its Yahoo Finance form (identity when unmapped). */
export function toYahooSymbol(s: string): string {
  return SYMBOL_MAP[s.toUpperCase()] ?? s;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface ChartMeta {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  currency?: string;
  exchangeName?: string;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: {
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }[];
  };
}

interface ChartResponse {
  chart?: { result?: ChartResult[] | null };
}

async function fetchChart(symbol: string, interval: string, range: string): Promise<ChartResult> {
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (attempt === 0) continue; // one retry on network/timeout
      throw new ProviderError(`Yahoo network error: ${String(err)}`, "upstream");
    }
    if (res.status === 404) {
      throw new ProviderError(`Yahoo: no chart for ${symbol} (HTTP 404)`, "not_found");
    }
    if (res.status === 429) {
      throw new ProviderError("Yahoo rate limit (429)", "rate_limit");
    }
    if (res.status >= 500) {
      if (attempt === 0) continue; // one retry on 5xx
      throw new ProviderError(`Yahoo HTTP ${res.status}`, "upstream");
    }
    if (!res.ok) {
      throw new ProviderError(`Yahoo HTTP ${res.status}`, "upstream");
    }
    const json = (await res.json()) as ChartResponse;
    const result = json.chart?.result?.[0];
    if (!result) throw new ProviderError(`Yahoo: no chart for ${symbol}`, "not_found");
    return result;
  }
  throw new ProviderError("Yahoo request failed", "upstream");
}

function toBars(result: ChartResult): Bar[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    // Gaps in the series show up as nulls — skip those points.
    if (t == null || open == null || high == null || low == null || close == null) continue;
    bars.push({ time: Math.floor(t), open, high, low, close, volume: num(q.volume?.[i]) });
  }
  return bars;
}

export const yahoo = {
  isConfigured(): true {
    return true; // keyless — always configured
  },

  async getQuote(symbol: string): Promise<Quote> {
    const result = await fetchChart(toYahooSymbol(symbol), "1d", "5d");
    const meta = result.meta ?? {};
    const price = num(meta.regularMarketPrice);
    if (!price) throw new ProviderError(`Yahoo: no price for ${symbol}`, "not_found");
    const prevClose = num(meta.chartPreviousClose ?? meta.previousClose);
    const change = price - prevClose;
    return {
      provider: "yahoo",
      status: "DELAYED",
      asOf: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      price,
      change,
      changePct: prevClose ? change / prevClose : 0,
      bid: price,
      ask: price, // not provided by the chart API
      open: prevClose, // chart meta has no regular-session open
      high: num(meta.regularMarketDayHigh),
      low: num(meta.regularMarketDayLow),
      prevClose,
      volume: num(meta.regularMarketVolume),
      avgVolume: 0, // omitted — not in chart meta
      week52High: num(meta.fiftyTwoWeekHigh),
      week52Low: num(meta.fiftyTwoWeekLow),
      marketState: "CLOSED", // caller may override
    };
  },

  async getBars(symbol: string, interval: Interval, range: AppRange): Promise<Bar[]> {
    const result = await fetchChart(toYahooSymbol(symbol), interval, RANGES[range]);
    return toBars(result);
  },

  async getOptionsChain(symbol: string, expiry?: string): Promise<OptionsChain> {
    const sym = symbol.trim().toUpperCase();
    const first = await fetchOptions(toYahooSymbol(sym));
    const expirations = (first.expirationDates ?? []).slice().sort((a, b) => a - b);
    if (expirations.length === 0) {
      throw new ProviderError(`Yahoo: no option expirations for ${sym}`, "not_found");
    }
    const wanted = expiry ? new Date(`${expiry}T00:00:00Z`).getTime() / 1000 : null;
    // Default to the first expiry at least ~3 weeks out; front weeklies are noisy.
    const minEpoch = Date.now() / 1000 + 21 * 86_400;
    const chosen =
      (wanted != null ? expirations.find((e) => Math.abs(e - wanted) < 43_200) : undefined) ??
      expirations.find((e) => e >= minEpoch) ??
      expirations[expirations.length - 1]!;
    const loaded = first.options?.[0]?.expirationDate ?? 0;
    const result = Math.abs(loaded - chosen) < 43_200
      ? first
      : await fetchOptions(toYahooSymbol(sym), chosen);
    let spot = num(result.quote?.regularMarketPrice);
    if (!spot) spot = (await yahoo.getQuote(sym)).price;
    return toOptionsChain(sym, result, expirations, chosen, spot);
  },
};

// ─── Options chains (v7/finance/options — cookie + crumb required) ──────────
// Yahoo gates the options API behind a consent cookie plus a crumb token.
// Crumb rejection and 429s are routine; callers treat a ProviderError here as
// "options unavailable" and fall back to labeled sample data.

const CRUMB_TTL = 30 * 60_000;
let crumbCache: { cookie: string; crumb: string; at: number } | null = null;

async function getCrumb(forceRefresh = false): Promise<{ cookie: string; crumb: string }> {
  if (!forceRefresh && crumbCache && Date.now() - crumbCache.at < CRUMB_TTL) return crumbCache;
  // fc.yahoo.com is the lightweight endpoint that sets the consent cookie.
  const jar = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const headers = jar?.headers;
  const setCookies: string[] =
    headers && typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers?.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).filter(Boolean);
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const res = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new ProviderError("Yahoo crumb rate limit (429)", "rate_limit");
  if (!res.ok) throw new ProviderError(`Yahoo crumb HTTP ${res.status}`, "upstream");
  const crumb = (await res.text()).trim();
  if (!crumb || crumb.length > 64 || crumb.includes("<")) {
    throw new ProviderError("Yahoo crumb rejected", "upstream");
  }
  crumbCache = { cookie, crumb, at: Date.now() };
  return crumbCache;
}

interface RawOptionContract {
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  volume?: number | null;
  openInterest?: number | null;
  impliedVolatility?: number;
}

interface RawOptionsResult {
  expirationDates?: number[];
  options?: { expirationDate?: number; calls?: RawOptionContract[]; puts?: RawOptionContract[] }[];
  quote?: { regularMarketPrice?: number };
}

/** quoteSummary modules (assetProfile, financialData, …) — same crumb gate as options. */
export async function fetchQuoteSummary(
  symbol: string,
  modules: string[],
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cookie, crumb } = await getCrumb(attempt > 0);
    const params = new URLSearchParams({ modules: modules.join(","), crumb });
    let res: Response;
    try {
      res = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`,
        { headers: { "User-Agent": USER_AGENT, Cookie: cookie }, signal: AbortSignal.timeout(15_000) },
      );
    } catch (err) {
      if (attempt === 0) continue; // one retry on network/timeout
      throw new ProviderError(`Yahoo quoteSummary network error: ${String(err)}`, "upstream");
    }
    if (res.status === 401 || res.status === 403) {
      if (attempt === 0) continue; // stale crumb — refresh once and retry
      throw new ProviderError("Yahoo quoteSummary auth rejected", "upstream");
    }
    if (res.status === 429) throw new ProviderError("Yahoo quoteSummary rate limit (429)", "rate_limit");
    if (res.status === 404) throw new ProviderError(`Yahoo: no quoteSummary for ${symbol}`, "not_found");
    if (!res.ok) throw new ProviderError(`Yahoo quoteSummary HTTP ${res.status}`, "upstream");
    const json = (await res.json()) as {
      quoteSummary?: { result?: Record<string, unknown>[] | null; error?: { code?: string; description?: string } | null };
    };
    if (json.quoteSummary?.error) {
      const desc = json.quoteSummary.error.description ?? "unknown";
      const kind = /not found/i.test(desc) ? "not_found" : "upstream";
      throw new ProviderError(`Yahoo quoteSummary: ${desc}`, kind);
    }
    const result = json.quoteSummary?.result?.[0];
    if (!result) throw new ProviderError(`Yahoo: no quoteSummary for ${symbol}`, "not_found");
    return result;
  }
  throw new ProviderError("Yahoo quoteSummary request failed", "upstream");
}

async function fetchOptions(symbol: string, dateEpoch?: number): Promise<RawOptionsResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cookie, crumb } = await getCrumb(attempt > 0);
    const params = new URLSearchParams({ crumb });
    if (dateEpoch) params.set("date", String(dateEpoch));
    let res: Response;
    try {
      res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?${params}`,
        { headers: { "User-Agent": USER_AGENT, Cookie: cookie }, signal: AbortSignal.timeout(15_000) },
      );
    } catch (err) {
      if (attempt === 0) continue; // one retry on network/timeout
      throw new ProviderError(`Yahoo options network error: ${String(err)}`, "upstream");
    }
    if (res.status === 401 || res.status === 403) {
      if (attempt === 0) continue; // stale crumb — refresh once and retry
      throw new ProviderError("Yahoo options auth rejected", "upstream");
    }
    if (res.status === 429) throw new ProviderError("Yahoo options rate limit (429)", "rate_limit");
    if (res.status === 404) throw new ProviderError(`Yahoo: no options for ${symbol}`, "not_found");
    if (!res.ok) throw new ProviderError(`Yahoo options HTTP ${res.status}`, "upstream");
    const json = (await res.json()) as { optionChain?: { result?: RawOptionsResult[] | null } };
    const result = json.optionChain?.result?.[0];
    if (!result) throw new ProviderError(`Yahoo: no options for ${symbol}`, "not_found");
    return result;
  }
  throw new ProviderError("Yahoo options request failed", "upstream");
}

const toIsoDate = (epoch: number): string => new Date(epoch * 1000).toISOString().slice(0, 10);

function toOptionsChain(
  sym: string,
  result: RawOptionsResult,
  expirations: number[],
  chosenEpoch: number,
  spot: number,
): OptionsChain {
  const RATE = 0.043; // same risk-free assumption as the rest of the app
  const expiryIso = toIsoDate(chosenEpoch);
  const tYears = Math.max(1 / 365, (chosenEpoch * 1000 - Date.now()) / (365 * 86_400_000));
  const raw = result.options?.[0];
  const contracts: OptionContract[] = [];
  const mapSide = (list: RawOptionContract[] | undefined, type: "CALL" | "PUT") => {
    for (const c of list ?? []) {
      const strike = num(c.strike);
      if (!strike) continue;
      // Yahoo supplies real per-contract IV (decimal); greeks are derived from
      // it via Black-Scholes since Yahoo does not publish greeks.
      const iv = Math.max(0.05, num(c.impliedVolatility));
      const bid = num(c.bid);
      const ask = num(c.ask);
      const last = num(c.lastPrice);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
      contracts.push({
        symbol: sym,
        expiry: expiryIso,
        strike,
        type,
        bid,
        ask,
        mid,
        last,
        volume: num(c.volume),
        openInterest: num(c.openInterest),
        iv,
        ...bsGreeks({ spot, strike, timeYears: tYears, rate: RATE, vol: iv, type }),
        spreadPct: mid > 0 ? Math.max(0, ask - bid) / mid : 0,
      });
    }
  };
  mapSide(raw?.calls, "CALL");
  mapSide(raw?.puts, "PUT");
  if (contracts.length === 0) {
    throw new ProviderError(`Yahoo: empty options chain for ${sym}`, "not_found");
  }
  // 1-sigma expected move from the ATM call's IV.
  const atmIv =
    contracts
      .filter((c) => c.type === "CALL")
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0]?.iv ?? 0.3;
  const em = expectedMove(spot, atmIv, tYears);
  return {
    provider: "yahoo",
    status: "DELAYED",
    asOf: new Date().toISOString(),
    symbol: sym,
    underlyingPrice: spot,
    expiries: expirations.map(toIsoDate),
    expiry: expiryIso,
    contracts,
    expectedMove: { absolute: em, pct: em / spot },
  };
}

// ─── Symbol search (v1/finance/search, keyless) ─────────────────────────────

import type { InstrumentInfo, AssetClass } from "../types";

const TYPE_MAP: Record<string, AssetClass> = {
  EQUITY: "STOCK",
  ETF: "ETF",
  INDEX: "INDEX",
  CRYPTOCURRENCY: "CRYPTO",
  CURRENCY: "FX",
  FUTURE: "FUTURE",
  MUTUALFUND: "ETF",
};

interface YahooSearchQuote {
  symbol?: string;
  quoteType?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  sectorDisp?: string;
  industryDisp?: string;
  currency?: string;
}

/** Normalize Yahoo symbols back to app form: BTC-USD→BTC, EURUSD=X→EURUSD, CL=F→CL. */
function fromYahooSymbol(sym: string, quoteType: string | undefined): string {
  if (quoteType === "CRYPTOCURRENCY") return sym.replace(/-USD$/, "");
  if (quoteType === "CURRENCY") return sym.replace(/=X$/, "");
  if (quoteType === "FUTURE") return sym.replace(/=F$/, "");
  return sym;
}

export async function searchSymbols(q: string, limit = 12): Promise<InstrumentInfo[]> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${limit}&newsCount=0`,
    { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) },
  );
  if (res.status === 429) throw new ProviderError("Yahoo search rate limit", "rate_limit");
  if (!res.ok) throw new ProviderError(`Yahoo search HTTP ${res.status}`, "upstream");
  const json = (await res.json()) as { quotes?: YahooSearchQuote[] };
  const out: InstrumentInfo[] = [];
  for (const item of json.quotes ?? []) {
    if (!item.symbol || !item.quoteType) continue;
    const assetClass = TYPE_MAP[item.quoteType];
    if (!assetClass) continue;
    out.push({
      symbol: fromYahooSymbol(item.symbol, item.quoteType),
      name: item.shortname ?? item.longname ?? item.symbol,
      assetClass,
      exchange: item.exchDisp ?? "",
      currency: item.currency ?? "USD",
      sector: item.sectorDisp ?? null,
      industry: item.industryDisp ?? null,
    });
  }
  return out;
}
