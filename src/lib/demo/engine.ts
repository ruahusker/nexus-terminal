// ─── Deterministic demo data engine ─────────────────────────────────────────
// Every value is a pure function of (symbol, time). Same inputs → same outputs,
// so the demo is reproducible yet evolves realistically with the clock.
// ALL data from this module is SAMPLE data and is labeled as such in the UI.

import { seededRng, gaussian, randInt, hashString } from "../rng";
import { UNIVERSE, UNIVERSE_MAP, SECTOR_ETFS, type UniverseEntry } from "./universe";
import { bsGreeks, bsPrice, expectedMove } from "../blackScholes";
import { annualizedVol, rsi } from "../indicators";
import type {
  Bar, BarInterval, EconEvent, EconSeries, Filing, Fundamentals, MarketOverview,
  NewsItem, OptionContract, OptionsChain, Quote, ScreenerRow,
} from "../types";

const DAY_MS = 86_400_000;
const PROV = { provider: "demo", status: "SAMPLE" as const };

function entry(symbol: string): UniverseEntry {
  const e = UNIVERSE_MAP.get(symbol.toUpperCase());
  if (!e) throw new Error(`Unknown symbol: ${symbol}`);
  return e;
}

function isAlwaysOpen(e: UniverseEntry): boolean {
  return e.assetClass === "CRYPTO" || e.assetClass === "FX";
}

/** Is a US-style venue open at this instant? (Mon–Fri 09:30–16:00 ET approximation, in UTC 13:30–20:00) */
export function marketState(e: UniverseEntry, at = new Date()): Quote["marketState"] {
  if (isAlwaysOpen(e)) return "ALWAYS";
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return "CLOSED";
  const mins = at.getUTCHours() * 60 + at.getUTCMinutes();
  if (mins >= 13 * 60 + 30 && mins < 20 * 60) return "REGULAR";
  if (mins >= 8 * 60 && mins < 13 * 60 + 30) return "PRE";
  if (mins >= 20 * 60 && mins < 24 * 60) return "POST";
  return "OVERNIGHT"; // weekday 00:00–08:00 UTC — the broker 24h-market window
}

/** Daily close for a symbol on a given UTC day index (days since epoch).
 *  Random walk seeded per day. Uses a per-symbol prefix-sum cache so repeated
 *  lookups are O(1) after the first build (screener/overview call this a lot). */
const SPAN_DAYS = 2700;
const returnsCache = new Map<string, { prefix: Float64Array; startIdx: number; todayIdx: number }>();

function returnsTable(symbol: string): { prefix: Float64Array; startIdx: number; todayIdx: number } {
  const e = entry(symbol);
  const todayIdx = Math.floor(Date.now() / DAY_MS);
  const hit = returnsCache.get(symbol);
  if (hit && hit.todayIdx === todayIdx) return hit;
  const vol = e.vol ?? 0.3;
  const startIdx = todayIdx - SPAN_DAYS;
  const prefix = new Float64Array(SPAN_DAYS + 1);
  let acc = 0;
  for (let d = startIdx + 1; d <= todayIdx; d++) {
    const rng = seededRng(`${symbol}:day:${d}`);
    acc += gaussian(rng) * (vol / Math.sqrt(252)) + 0.0002;
    prefix[d - startIdx] = acc;
  }
  const table = { prefix, startIdx, todayIdx };
  returnsCache.set(symbol, table);
  return table;
}

export function dailyClose(symbol: string, dayIndex: number): number {
  const e = entry(symbol);
  const { prefix, startIdx, todayIdx } = returnsTable(symbol);
  const clamp = (d: number) => Math.max(startIdx, Math.min(todayIdx, d));
  const sumAfter = (prefix[todayIdx - startIdx] ?? 0) - (prefix[clamp(dayIndex) - startIdx] ?? 0);
  return Math.exp(Math.log(e.basePrice) - sumAfter);
}

const barsCache = new Map<string, Bar[]>();

export function dailyBars(symbol: string, count: number): Bar[] {
  const key = `${symbol}:${count}:${Math.floor(Date.now() / DAY_MS)}`;
  const hit = barsCache.get(key);
  if (hit) return hit;
  const todayIdx = Math.floor(Date.now() / DAY_MS);
  const bars: Bar[] = [];
  // ~7/5 days to cover weekends, then trim
  const needed = Math.ceil(count * 1.5) + 10;
  for (let d = todayIdx - needed; d <= todayIdx; d++) {
    const dow = new Date(d * DAY_MS).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const close = dailyClose(symbol, d);
    const prev = dailyClose(symbol, d - 1);
    const rng = seededRng(`${symbol}:ohlcv:${d}`);
    const open = prev * (1 + gaussian(rng) * 0.002);
    const hi = Math.max(open, close) * (1 + rng() * 0.012);
    const lo = Math.min(open, close) * (1 - rng() * 0.012);
    const e = entry(symbol);
    const baseVol = (e.sharesOut ?? (e.marketCap ?? 50e9) / e.basePrice) * 0.004;
    const volume = Math.max(1000, Math.round(baseVol * (0.5 + rng() * 1.4)));
    bars.push({ time: d * 86400, open, high: hi, low: lo, close, volume });
  }
  const result = bars.slice(-count);
  barsCache.set(key, result);
  return result;
}

/** Intraday micro-noise around the daily anchor, seeded per 1-minute bucket. */
function intradayFactor(symbol: string, atMs: number): number {
  const bucket = Math.floor(atMs / 60_000);
  const rng = seededRng(`${symbol}:min:${bucket}`);
  const e = entry(symbol);
  const amp = (e.vol ?? 0.3) / Math.sqrt(252 * 390) * 2.5;
  return 1 + gaussian(rng) * amp;
}

export function getQuote(symbol: string, at = new Date()): Quote {
  const e = entry(symbol);
  const dayIdx = Math.floor(at.getTime() / DAY_MS);
  const state = marketState(e, at);
  const anchor = dailyClose(symbol, dayIdx);
  const live = state === "REGULAR" || state === "ALWAYS" || state === "PRE" || state === "POST" || state === "OVERNIGHT";
  const price = live ? anchor * intradayFactor(symbol, at.getTime()) : anchor;
  const prevClose = dailyClose(symbol, dayIdx - 1);
  const rng = seededRng(`${symbol}:q:${dayIdx}`);
  const spreadBps = e.assetClass === "CRYPTO" ? 8 : e.assetClass === "FX" ? 3 : e.basePrice > 500 ? 6 : 2;
  const half = (price * spreadBps) / 20_000;
  const bars = dailyBars(symbol, 260);
  const todayBar = bars[bars.length - 1];
  const yearBars = bars.slice(-252);
  const change = price - prevClose;
  const avgVol = yearBars.reduce((a, b) => a + b.volume, 0) / Math.max(1, yearBars.length);
  const frac = state === "REGULAR" ? Math.min(1, Math.max(0.02, ((at.getUTCHours() * 60 + at.getUTCMinutes() - 810) / 390))) : 1;
  return {
    ...PROV,
    asOf: at.toISOString(),
    symbol: e.symbol,
    name: e.name,
    price,
    change,
    changePct: prevClose !== 0 ? change / prevClose : 0,
    bid: price - half,
    ask: price + half,
    open: todayBar?.open ?? prevClose,
    high: Math.max(todayBar?.high ?? price, price),
    low: Math.min(todayBar?.low ?? price, price),
    prevClose,
    volume: Math.round((todayBar?.volume ?? avgVol) * frac),
    avgVolume: Math.round(avgVol),
    week52High: Math.max(...yearBars.map((b) => b.high)),
    week52Low: Math.min(...yearBars.map((b) => b.low)),
    marketState: state,
    ...(rng() ? {} : {}), // keep rng consumed for stability of any future fields
  };
}

const RANGE_DAYS: Record<string, number> = {
  "1D": 1, "5D": 5, "1M": 22, "3M": 66, "6M": 132, "1Y": 252, "2Y": 504, "5Y": 1260, MAX: 2500,
};

export function getBars(symbol: string, interval: BarInterval, range: string): Bar[] {
  const days = RANGE_DAYS[range] ?? 252;
  if (interval === "1d" || interval === "1wk") {
    const daily = dailyBars(symbol, interval === "1wk" ? days * 1.2 : days);
    if (interval === "1d") return daily.slice(-days);
    // aggregate to weekly
    const weekly: Bar[] = [];
    for (let i = 0; i < daily.length; i += 5) {
      const chunk = daily.slice(i, i + 5);
      if (chunk.length === 0) continue;
      weekly.push({
        time: (chunk[0] as Bar).time,
        open: (chunk[0] as Bar).open,
        high: Math.max(...chunk.map((b) => b.high)),
        low: Math.min(...chunk.map((b) => b.low)),
        close: (chunk[chunk.length - 1] as Bar).close,
        volume: chunk.reduce((a, b) => a + b.volume, 0),
      });
    }
    return weekly.slice(-Math.ceil(days / 5));
  }
  // intraday: synthesize minute bars for recent days from the daily anchor
  const minsPerBar = interval === "1m" ? 1 : interval === "5m" ? 5 : interval === "15m" ? 15 : 60;
  const barsPerDay = Math.floor(390 / minsPerBar);
  const total = Math.min(barsPerDay * Math.min(days, 10), 390 * 10);
  const now = Date.now();
  const bars: Bar[] = [];
  for (let i = total; i >= 1; i--) {
    const tMs = now - i * minsPerBar * 60_000;
    const dayIdx = Math.floor(tMs / DAY_MS);
    const anchor = dailyClose(symbol, dayIdx);
    const o = anchor * intradayFactor(symbol, tMs);
    const c = anchor * intradayFactor(symbol, tMs + minsPerBar * 60_000);
    const e = entry(symbol);
    const rng = seededRng(`${symbol}:ib:${Math.floor(tMs / (minsPerBar * 60_000))}`);
    const dv = dailyBars(symbol, 5).at(-1)?.volume ?? 1e6;
    bars.push({
      time: Math.floor(tMs / 1000),
      open: o,
      high: Math.max(o, c) * (1 + rng() * 0.001),
      low: Math.min(o, c) * (1 - rng() * 0.001),
      close: c,
      volume: Math.round((dv / barsPerDay) * (0.3 + rng() * 1.8)),
    });
  }
  return bars;
}

// ─── Options ────────────────────────────────────────────────────────────────

export function getExpiries(symbol: string): string[] {
  const out: string[] = [];
  const now = new Date();
  // next 4 weeklies (Fridays) + monthlies up to ~1y
  const d = new Date(now);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 5; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  const monthly = new Date(now.getUTCFullYear(), now.getUTCMonth(), 15);
  for (let m = 0; m < 12; m++) {
    const t = new Date(monthly.getUTCFullYear(), monthly.getUTCMonth() + m, 15);
    while (t.getUTCDay() !== 5) t.setUTCDate(t.getUTCDate() + (t.getUTCDay() < 5 ? 1 : -2));
    const iso = t.toISOString().slice(0, 10);
    if (!out.includes(iso) && t.getTime() > now.getTime()) out.push(iso);
  }
  return out.sort();
}

export function getOptionsChain(symbol: string, expiry?: string): OptionsChain {
  const e = entry(symbol);
  const expiries = getExpiries(symbol);
  const exp = expiry && expiries.includes(expiry) ? expiry : (expiries[2] ?? expiries[0]) as string;
  const q = getQuote(symbol);
  const spot = q.price;
  const bars = dailyBars(symbol, 120);
  const hv = annualizedVol(bars.map((b) => b.close)) ?? e.vol ?? 0.3;
  const ivBase = hv * 1.15; // demo: IV trades at modest premium to HV
  const tYears = Math.max(1 / 365, (new Date(exp + "T16:00:00Z").getTime() - Date.now()) / (365 * DAY_MS));
  const rate = 0.043;
  const step = spot > 1000 ? 25 : spot > 200 ? 5 : spot > 50 ? 2.5 : spot > 5 ? 1 : 0.5;
  const nStrikes = 14;
  const atm = Math.round(spot / step) * step;
  const contracts: OptionContract[] = [];
  for (let k = -nStrikes; k <= nStrikes; k++) {
    const strike = atm + k * step;
    const moneyness = Math.log(strike / spot);
    // volatility skew: OTM puts richer, smile for far OTM calls
    const skew = ivBase * (1 - 0.35 * moneyness + 0.8 * moneyness * moneyness);
    for (const type of ["CALL", "PUT"] as const) {
      const iv = Math.max(0.05, type === "PUT" ? skew : ivBase * (1 - 0.25 * moneyness + 0.9 * moneyness * moneyness));
      const theo = bsPrice({ spot, strike, timeYears: tYears, rate, vol: iv, type });
      const g = bsGreeks({ spot, strike, timeYears: tYears, rate, vol: iv, type });
      const rng = seededRng(`${symbol}:${exp}:${strike}:${type}`);
      const sprPct = Math.min(0.35, 0.01 + Math.abs(g.delta - 0.5) * 0.18 + (1 - Math.min(1, tYears * 12)) * 0.1);
      const half = Math.max(0.01, (theo * sprPct) / 2);
      const bid = Math.max(0, theo - half);
      const ask = theo + half;
      const oiBase = Math.max(0, 8000 * Math.exp(-Math.abs(k) * 0.35) * (type === "PUT" && k < 0 ? 1.4 : 1));
      contracts.push({
        symbol: e.symbol, expiry: exp, strike, type,
        bid: Math.round(bid * 100) / 100,
        ask: Math.round(ask * 100) / 100,
        mid: Math.round(theo * 100) / 100,
        last: Math.round((theo + gaussian(rng) * half * 0.4) * 100) / 100,
        volume: Math.round(oiBase * (0.05 + rng() * 0.5)),
        openInterest: Math.round(oiBase * (1 + rng() * 2)),
        iv, ...g, spreadPct: (ask - bid) / Math.max(0.01, theo),
      });
    }
  }
  const em = expectedMove(spot, ivBase, tYears);
  return { ...PROV, asOf: new Date().toISOString(), symbol: e.symbol, underlyingPrice: spot, expiries, expiry: exp, contracts, expectedMove: { absolute: em, pct: em / spot } };
}

// ─── News (clearly-labeled SAMPLE stories) ──────────────────────────────────

const NEWS_TOPICS = ["Earnings", "M&A", "Macro", "Central Banks", "Technology", "Energy", "Regulation", "Crypto"];
const NEWS_SOURCES = ["Nexus Wire", "Market Desk", "Capital Report", "The Ledger", "Global Markets Daily"];

const STORY_TEMPLATES: { headline: (n: string, s: string) => string; topic: string }[] = [
  { headline: (n) => `${n} quarterly results top sample estimates on margin strength`, topic: "Earnings" },
  { headline: (n) => `${n} announces expanded buyback authorization in sample filing`, topic: "M&A" },
  { headline: (n) => `Analysts raise sample price targets on ${n} after guidance update`, topic: "Earnings" },
  { headline: (n) => `${n} unveils next-generation product roadmap at investor day`, topic: "Technology" },
  { headline: (n) => `Regulators open sample review of ${n} partnership structure`, topic: "Regulation" },
  { headline: () => `Treasury yields drift as traders reassess sample rate path`, topic: "Central Banks" },
  { headline: () => `Sample CPI reading lands near consensus; rate-cut odds steady`, topic: "Macro" },
  { headline: () => `Crude oil steadies after weekly inventory sample data`, topic: "Energy" },
  { headline: () => `Digital assets extend weekly move as sample ETF flows rise`, topic: "Crypto" },
  { headline: () => `Global fund managers trim sample equity exposure, survey shows`, topic: "Macro" },
  { headline: (n) => `${n} supply-chain costs ease in sample channel checks`, topic: "Technology" },
  { headline: (n) => `${n} faces sample shareholder proposal on capital allocation`, topic: "Regulation" },
];

export function getNews(opts: { symbol?: string; topic?: string; q?: string; limit?: number } = {}): NewsItem[] {
  const items: NewsItem[] = [];
  const now = Date.now();
  const universe = UNIVERSE.filter((u) => u.assetClass === "STOCK" || u.assetClass === "CRYPTO");
  for (let i = 0; i < 60; i++) {
    const rng = seededRng(`news:${i}`);
    const tmpl = STORY_TEMPLATES[Math.floor(rng() * STORY_TEMPLATES.length)] as (typeof STORY_TEMPLATES)[number];
    const withSymbol = rng() < 0.72;
    const inst = universe[Math.floor(rng() * universe.length)] as UniverseEntry;
    const publishedAt = new Date(now - randInt(rng, 3, 60 * 48) * 60_000).toISOString();
    const headline = withSymbol ? tmpl.headline(inst.name, inst.symbol) : tmpl.headline("", "");
    const topic = tmpl.topic;
    if (opts.symbol) {
      const sym = opts.symbol.toUpperCase();
      const isMatch = withSymbol && inst.symbol === sym;
      const isGeneral = !withSymbol; // macro/market-wide stories stay in symbol feeds
      if (!isMatch && !isGeneral) continue;
    }
    if (opts.topic && topic !== opts.topic) continue;
    if (opts.q && !headline.toLowerCase().includes(opts.q.toLowerCase())) continue;
    items.push({
      ...PROV,
      asOf: new Date().toISOString(),
      id: `sample-${i}-${hashString(headline).toString(36)}`,
      headline,
      summary: `[SAMPLE] ${headline}. This is generated demonstration copy for layout purposes only — it is not real reporting and must not be used for any decision.`,
      source: NEWS_SOURCES[Math.floor(rng() * NEWS_SOURCES.length)] as string,
      url: "#sample-story",
      symbols: withSymbol ? [inst.symbol] : [],
      topics: [topic],
      publishedAt,
      sample: true,
    });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return items.slice(0, opts.limit ?? 40);
}

export function getFilings(symbol: string): Filing[] {
  const e = entry(symbol);
  const rng = seededRng(`filings:${symbol}`);
  const types = ["10-K", "10-Q", "8-K", "DEF 14A", "4", "S-8"];
  const out: Filing[] = [];
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    const t = types[Math.floor(rng() * types.length)] as string;
    out.push({
      id: `filing-${symbol}-${i}`,
      symbol: e.symbol,
      type: t,
      title: `[SAMPLE] ${t} — ${e.name} ${t === "10-K" ? "annual report" : t === "10-Q" ? "quarterly report" : t === "8-K" ? "current report" : "filing"}`,
      filedAt: new Date(now - randInt(rng, 5, 400) * DAY_MS).toISOString(),
      url: "#sample-filing",
      sample: true,
    });
  }
  out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  return out;
}

// ─── Economy ────────────────────────────────────────────────────────────────

// Approximate publicly-known historical values (facts), used to render charts.
const ECON_SERIES: Record<string, { name: string; category: EconSeries["category"]; unit: string; frequency: EconSeries["frequency"]; points: [string, number][] }> = {
  FEDFUNDS: { name: "Federal Funds Target Rate (upper bound)", category: "RATES", unit: "%", frequency: "DAILY", points: [["2022-03", 0.5], ["2022-06", 1.75], ["2022-09", 3.25], ["2022-12", 4.5], ["2023-03", 5.0], ["2023-07", 5.5], ["2024-09", 5.0], ["2024-11", 4.75], ["2024-12", 4.5], ["2025-06", 4.5], ["2025-12", 4.0]] },
  US10Y: { name: "US 10-Year Treasury Yield", category: "RATES", unit: "%", frequency: "DAILY", points: [["2022-01", 1.75], ["2022-07", 2.9], ["2023-01", 3.5], ["2023-07", 3.95], ["2023-10", 4.9], ["2024-01", 4.1], ["2024-07", 4.2], ["2025-01", 4.6], ["2025-07", 4.4], ["2025-12", 4.25]] },
  US02Y: { name: "US 2-Year Treasury Yield", category: "RATES", unit: "%", frequency: "DAILY", points: [["2022-01", 0.9], ["2022-07", 3.0], ["2023-01", 4.2], ["2023-07", 4.9], ["2024-01", 4.2], ["2024-07", 4.4], ["2025-01", 4.3], ["2025-07", 3.9], ["2025-12", 3.65]] },
  CPI_YOY: { name: "US CPI Inflation (YoY)", category: "INFLATION", unit: "%", frequency: "MONTHLY", points: [["2022-01", 7.5], ["2022-06", 9.1], ["2022-12", 6.5], ["2023-06", 3.0], ["2023-12", 3.4], ["2024-06", 3.0], ["2024-12", 2.9], ["2025-06", 2.7], ["2025-12", 2.6]] },
  CORE_PCE: { name: "Core PCE Price Index (YoY)", category: "INFLATION", unit: "%", frequency: "MONTHLY", points: [["2022-01", 5.2], ["2022-12", 4.9], ["2023-06", 4.3], ["2023-12", 2.9], ["2024-06", 2.6], ["2024-12", 2.8], ["2025-06", 2.7], ["2025-12", 2.5]] },
  UNRATE: { name: "US Unemployment Rate", category: "EMPLOYMENT", unit: "%", frequency: "MONTHLY", points: [["2022-01", 4.0], ["2022-07", 3.5], ["2023-01", 3.4], ["2023-07", 3.5], ["2024-01", 3.7], ["2024-07", 4.3], ["2025-01", 4.0], ["2025-07", 4.2], ["2025-12", 4.1]] },
  NFP: { name: "Nonfarm Payrolls (monthly change)", category: "EMPLOYMENT", unit: "K", frequency: "MONTHLY", points: [["2022-01", 504], ["2022-07", 352], ["2023-01", 472], ["2023-07", 187], ["2024-01", 256], ["2024-07", 144], ["2025-01", 143], ["2025-07", 158], ["2025-12", 172]] },
  GDP_QOQ: { name: "US Real GDP (annualized QoQ)", category: "GDP", unit: "%", frequency: "QUARTERLY", points: [["2022-Q1", -1.6], ["2022-Q3", 3.2], ["2023-Q1", 2.2], ["2023-Q3", 4.9], ["2024-Q1", 1.4], ["2024-Q3", 3.1], ["2025-Q1", -0.5], ["2025-Q3", 2.8]] },
  RETAIL: { name: "Retail Sales (MoM)", category: "CONSUMER", unit: "%", frequency: "MONTHLY", points: [["2022-01", 3.8], ["2022-07", 0.0], ["2023-01", 3.2], ["2023-07", 0.7], ["2024-01", -0.8], ["2024-07", 1.0], ["2025-01", -0.9], ["2025-07", 0.6], ["2025-12", 0.4]] },
  UOM_SENT: { name: "U. Michigan Consumer Sentiment", category: "CONSUMER", unit: "idx", frequency: "MONTHLY", points: [["2022-01", 67.2], ["2022-07", 51.5], ["2023-01", 64.9], ["2023-07", 71.6], ["2024-01", 79.0], ["2024-07", 66.4], ["2025-01", 71.1], ["2025-07", 61.7], ["2025-12", 68.2]] },
};

export function getEconSeries(id: string): EconSeries | null {
  const s = ECON_SERIES[id];
  if (!s) return null;
  return { ...PROV, asOf: new Date().toISOString(), id, name: s.name, category: s.category, unit: s.unit, frequency: s.frequency, points: s.points.map(([date, value]) => ({ date, value })) };
}

export function listEconSeries(): { id: string; name: string; category: string; latest: number; unit: string }[] {
  return Object.entries(ECON_SERIES).map(([id, s]) => ({
    id, name: s.name, category: s.category,
    latest: (s.points[s.points.length - 1] as [string, number])[1],
    unit: s.unit,
  }));
}

export function getEconCalendar(): EconEvent[] {
  const out: EconEvent[] = [];
  const now = new Date();
  const rng = seededRng(`econcal:${now.toISOString().slice(0, 10)}`);
  const events = [
    { name: "CPI Inflation (YoY)", unit: "%", importance: 3 as const, prev: 2.6 },
    { name: "Nonfarm Payrolls", unit: "K", importance: 3 as const, prev: 172 },
    { name: "FOMC Rate Decision", unit: "%", importance: 3 as const, prev: 4.0 },
    { name: "Retail Sales (MoM)", unit: "%", importance: 2 as const, prev: 0.4 },
    { name: "GDP (annualized QoQ)", unit: "%", importance: 3 as const, prev: 2.8 },
    { name: "Initial Jobless Claims", unit: "K", importance: 2 as const, prev: 224 },
    { name: "Core PCE (YoY)", unit: "%", importance: 3 as const, prev: 2.5 },
    { name: "ISM Manufacturing PMI", unit: "idx", importance: 2 as const, prev: 49.2 },
    { name: "U. Michigan Sentiment", unit: "idx", importance: 1 as const, prev: 68.2 },
    { name: "Housing Starts", unit: "M", importance: 1 as const, prev: 1.36 },
  ];
  for (let i = -3; i < 10; i++) {
    const ev = events[randInt(rng, 0, events.length - 1)] as (typeof events)[number];
    const dt = new Date(now.getTime() + i * DAY_MS + randInt(rng, 12, 15) * 3600_000);
    const isPast = dt.getTime() < now.getTime();
    const forecast = ev.prev * (0.92 + rng() * 0.16);
    out.push({
      id: `ecal-${i}-${hashString(ev.name)}`,
      datetime: dt.toISOString(),
      country: "US",
      name: ev.name,
      importance: ev.importance,
      previous: ev.prev,
      forecast: Math.round(forecast * 100) / 100,
      actual: isPast ? Math.round(ev.prev * (0.9 + rng() * 0.2) * 100) / 100 : null,
      unit: ev.unit,
    });
  }
  return out.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

export function getYieldCurve(): { tenor: string; yield: number; changeBps: number }[] {
  const dayKey = new Date().toISOString().slice(0, 10);
  const rng = seededRng(`yc:${dayKey}`);
  const base: [string, number][] = [["3M", 4.32], ["2Y", 3.68], ["5Y", 3.82], ["10Y", 4.24], ["30Y", 4.48]];
  return base.map(([tenor, y]) => ({
    tenor,
    yield: Math.round((y + gaussian(rng) * 0.03) * 100) / 100,
    changeBps: Math.round(gaussian(rng) * 4),
  }));
}

// ─── Market overview ────────────────────────────────────────────────────────

export function getMarketOverview(): MarketOverview {
  const idx = ["SPX", "NDX", "DJI", "RUT", "FTSE", "DAX", "N225", "HSI"].map((s) => getQuote(s));
  const commodities = ["CL", "NG", "GC", "SI", "HG", "ZW"].map((s) => getQuote(s));
  const fx = ["EURUSD", "GBPUSD", "USDJPY", "DXY"].map((s) => getQuote(s));
  const crypto = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA"].map((s) => getQuote(s));
  const vix = getQuote("VIX");
  const stocks = UNIVERSE.filter((u) => u.assetClass === "STOCK").map((u) => getQuote(u.symbol));
  const byVol = [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 10);
  const gainers = [...stocks].sort((a, b) => b.changePct - a.changePct).slice(0, 10);
  const losers = [...stocks].sort((a, b) => a.changePct - b.changePct).slice(0, 10);
  const advancing = stocks.filter((q) => q.changePct > 0).length * 31;
  const declining = stocks.filter((q) => q.changePct < 0).length * 29;
  const sectors = SECTOR_ETFS.map((s) => {
    const q = getQuote(s);
    return { name: (UNIVERSE_MAP.get(s)?.sector ?? s), changePct: q.changePct };
  }).sort((a, b) => b.changePct - a.changePct);
  const now = new Date();
  return {
    ...PROV,
    asOf: now.toISOString(),
    indexes: idx,
    treasuries: getYieldCurve(),
    commodities, fx, crypto,
    breadth: { advancing, declining, unchanged: 412, newHighs: 84 + (hashString(dayKey()) % 60), newLows: 62 + (hashString(dayKey() + "l") % 50) },
    sectors,
    mostActive: byVol, gainers, losers,
    volatility: [
      { symbol: "VIX", name: "S&P 500 Volatility", value: vix.price, changePct: vix.changePct },
      { symbol: "MOVE", name: "Rate Volatility (sample)", value: 98 + (hashString(dayKey()) % 30), changePct: gaussian(seededRng(dayKey())) * 0.03 },
    ],
    marketStatus: {
      us: marketState(UNIVERSE_MAP.get("SPY") as UniverseEntry, now),
      europe: marketState(UNIVERSE_MAP.get("SPY") as UniverseEntry, new Date(now.getTime() - 5 * 3600_000)),
      asia: "CLOSED",
      crypto: "ALWAYS",
    },
  };
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Screener ───────────────────────────────────────────────────────────────

export function getScreenerRows(): ScreenerRow[] {
  return UNIVERSE.filter((u) => u.assetClass === "STOCK" || u.assetClass === "ETF").map((u) => {
    const q = getQuote(u.symbol);
    const rng = seededRng(`fund:${u.symbol}`);
    const closes = dailyBars(u.symbol, 30).map((b) => b.close);
    const r = rsi(closes, 14);
    const opt = u.optionable ? getOptionsChain(u.symbol) : null;
    const optVol = opt ? opt.contracts.reduce((a, c) => a + c.volume, 0) : null;
    const optOi = opt ? opt.contracts.reduce((a, c) => a + c.openInterest, 0) : null;
    const atmIv = opt ? (opt.contracts.find((c) => Math.abs(c.strike - opt.underlyingPrice) < 3 && c.type === "CALL")?.iv ?? null) : null;
    return {
      symbol: u.symbol, name: u.name, assetClass: u.assetClass, exchange: u.exchange, currency: u.currency,
      sector: u.sector ?? null, industry: u.industry ?? null, country: u.country,
      marketCap: u.marketCap ?? null, dividendYield: u.dividendYield ?? null, peRatio: u.peRatio ?? null,
      beta: u.beta ?? null, optionable: u.optionable,
      price: q.price, changePct: q.changePct, volume: q.volume, avgVolume: q.avgVolume,
      week52High: q.week52High, week52Low: q.week52Low,
      grossMargin: u.assetClass === "STOCK" ? Math.round((0.15 + rng() * 0.6) * 1000) / 1000 : null,
      revenueGrowth: u.assetClass === "STOCK" ? Math.round((-0.1 + rng() * 0.5) * 1000) / 1000 : null,
      roe: u.assetClass === "STOCK" ? Math.round((-0.05 + rng() * 0.55) * 1000) / 1000 : null,
      rsi14: r[r.length - 1] != null ? Math.round((r[r.length - 1] as number) * 10) / 10 : null,
      iv30: atmIv, optVolume: optVol, optOpenInterest: optOi,
    };
  });
}

// ─── Fundamentals ───────────────────────────────────────────────────────────

export function getFundamentals(symbol: string): Fundamentals {
  const e = entry(symbol);
  const rng = seededRng(`fin:${symbol}`);
  const mcap = e.marketCap ?? 50e9;
  const revBase = mcap / (2 + rng() * 6);
  const periods = ["FY2022", "FY2023", "FY2024"];
  const growth = () => 1 + (-0.02 + rng() * 0.22);
  let rev = revBase * 0.7;
  const income = periods.map((p) => {
    rev *= growth();
    const gross = rev * (0.25 + rng() * 0.45);
    const op = gross * (0.25 + rng() * 0.55);
    const net = op * (0.6 + rng() * 0.3);
    return { period: p, values: { Revenue: r2(rev), "Gross Profit": r2(gross), "Operating Income": r2(op), "Net Income": r2(net), "Diluted EPS": r2(net / (e.sharesOut ?? 1e9)) } };
  });
  const balance = periods.map((p) => ({ period: p, values: { "Cash & Equivalents": r2(rev * (0.1 + rng() * 0.4)), "Total Assets": r2(rev * (1.2 + rng() * 2)), "Total Debt": r2(rev * (0.1 + rng() * 0.8)), "Shareholders' Equity": r2(rev * (0.3 + rng() * 1.2)) } }));
  const cashflow = periods.map((p) => ({ period: p, values: { "Operating Cash Flow": r2(rev * (0.15 + rng() * 0.25)), "Capital Expenditure": r2(-rev * (0.03 + rng() * 0.12)), "Free Cash Flow": r2(rev * (0.08 + rng() * 0.2)) } }));
  const q = getQuote(symbol);
  const now = Date.now();
  const earningsCalendar = [0, 1, 2, 3, 4, 5].map((i) => {
    const dt = new Date(now + (i - 3) * 91 * DAY_MS + randInt(rng, 0, 20) * DAY_MS);
    const est = (rev / (e.sharesOut ?? 1e9)) / 4;
    const past = dt.getTime() < now;
    const actual = past ? est * (0.9 + rng() * 0.25) : null;
    return { date: dt.toISOString().slice(0, 10), epsEstimate: r2(est), epsActual: actual != null ? r2(actual) : null, surprise: actual != null ? r2((actual - est) / Math.max(0.01, Math.abs(est))) : null };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const related = UNIVERSE.filter((u) => u.sector === e.sector && u.symbol !== e.symbol && u.assetClass === "STOCK").slice(0, 6).map((u) => u.symbol);
  const analyst = e.assetClass === "STOCK" ? {
    rating: ["Strong Buy", "Buy", "Hold", "Buy"][Math.floor(rng() * 4)] as string,
    targetMean: r2(q.price * (0.9 + rng() * 0.35)),
    targetHigh: r2(q.price * (1.15 + rng() * 0.4)),
    targetLow: r2(q.price * (0.7 + rng() * 0.2)),
    count: randInt(rng, 8, 48),
  } : null;
  return {
    ...PROV, asOf: new Date().toISOString(), symbol: e.symbol,
    profile: {
      description: e.description ?? `${e.name} is a ${e.sector ?? "diversified"} company (${e.industry ?? "general industry"}). Sample profile text.`,
      sector: e.sector ?? "—", industry: e.industry ?? "—",
      employees: Math.round(mcap / (0.3e6 + rng() * 1.2e6)),
      headquarters: `${["New York, NY", "San Francisco, CA", "Seattle, WA", "Austin, TX", "Chicago, IL"][Math.floor(rng() * 5)]}, ${e.country ?? "US"}`,
      founded: 1950 + randInt(rng, 0, 70),
      website: `https://example.com/${e.symbol.toLowerCase()}`,
    },
    incomeStatement: income, balanceSheet: balance, cashFlow: cashflow,
    earningsCalendar, analystEstimates: analyst, related,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export function searchInstruments(q: string, limit = 24): UniverseEntry[] {
  const query = q.trim().toUpperCase();
  if (!query) return [];
  const scored = UNIVERSE.map((u) => {
    let score = 0;
    if (u.symbol === query) score = 100;
    else if (u.symbol.startsWith(query)) score = 80 - (u.symbol.length - query.length);
    else if (u.name.toUpperCase().includes(query)) score = 50 - u.name.toUpperCase().indexOf(query);
    else if (u.symbol.includes(query)) score = 30;
    if (score > 0) score += u.assetClass === "STOCK" ? 5 : 0;
    return { u, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.u);
}
