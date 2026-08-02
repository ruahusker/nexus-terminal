// ─── NEXUS Terminal domain types ────────────────────────────────────────────
// Every market datum carries provenance: provider, timestamp, and status.

export type AssetClass = "STOCK" | "ETF" | "INDEX" | "CRYPTO" | "FX" | "BOND" | "FUTURE";

export type DataStatus = "REALTIME" | "DELAYED" | "CACHED" | "SAMPLE";

export interface Provenance {
  provider: string; // e.g. "demo", "yahoo", "coinbase", "massive"
  asOf: string; // ISO timestamp
  status: DataStatus;
}

export interface InstrumentInfo {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  currency: string;
  sector?: string | null;
  industry?: string | null;
  country?: string;
  marketCap?: number | null;
  sharesOut?: number | null;
  dividendYield?: number | null;
  peRatio?: number | null;
  beta?: number | null;
  description?: string | null;
  optionable?: boolean;
}

export interface Quote extends Provenance {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  bid: number;
  ask: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  avgVolume: number;
  week52High: number;
  week52Low: number;
  marketState: "REGULAR" | "PRE" | "POST" | "CLOSED" | "ALWAYS" | "OVERNIGHT"; // ALWAYS = crypto/FX
  priceSession?: "REGULAR" | "EXTENDED"; // which venue the displayed price came from (Robinhood quotes)
}

export interface Bar {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type BarInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk";

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 vol point
  rho: number; // per 1 rate point
}

export interface OptionContract extends Greeks {
  symbol: string; // underlying
  expiry: string; // ISO date
  strike: number;
  type: "CALL" | "PUT";
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number; // decimal, e.g. 0.32
  spreadPct: number;
}

export interface OptionsChain extends Provenance {
  symbol: string;
  underlyingPrice: number;
  expiries: string[];
  expiry: string;
  contracts: OptionContract[];
  expectedMove: { absolute: number; pct: number }; // 1-sigma, straddle-implied
}

export interface NewsItem extends Provenance {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  symbols: string[];
  topics: string[];
  publishedAt: string; // ISO
  sample: boolean; // true = generated sample story, clearly labeled in UI
}

export interface EconEvent {
  id: string;
  datetime: string; // ISO
  country: string;
  name: string;
  importance: 1 | 2 | 3;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  unit: string;
  provider?: string; // "demo" or "fred"
  status?: DataStatus;
}

export interface EconSeries extends Provenance {
  id: string;
  name: string;
  category: "RATES" | "INFLATION" | "EMPLOYMENT" | "GDP" | "CONSUMER" | "CENTRAL_BANK";
  unit: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY";
  points: { date: string; value: number }[];
}

export interface MarketOverview extends Provenance {
  indexes: Quote[];
  treasuries: { tenor: string; yield: number; changeBps: number }[];
  commodities: Quote[];
  fx: Quote[];
  crypto: Quote[];
  breadth: { advancing: number; declining: number; unchanged: number; newHighs: number; newLows: number };
  sectors: { name: string; changePct: number }[];
  mostActive: Quote[];
  gainers: Quote[];
  losers: Quote[];
  volatility: { symbol: string; name: string; value: number; changePct: number }[];
  marketStatus: { us: string; europe: string; asia: string; crypto: string };
}

export interface ScreenerRow extends InstrumentInfo {
  provider?: string; // "demo" in demo mode; "yahoo"/"multi" in provider mode
  status?: DataStatus;
  price: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  week52High: number;
  week52Low: number;
  grossMargin?: number | null;
  revenueGrowth?: number | null;
  roe?: number | null;
  rsi14?: number | null;
  iv30?: number | null;
  optVolume?: number | null;
  optOpenInterest?: number | null;
}

export interface Fundamentals extends Provenance {
  symbol: string;
  profile: { description: string; sector: string; industry: string; employees: number; headquarters: string; founded: number; website: string };
  incomeStatement: FinancialPeriod[];
  balanceSheet: FinancialPeriod[];
  cashFlow: FinancialPeriod[];
  earningsCalendar: { date: string; epsEstimate: number | null; epsActual: number | null; surprise: number | null }[];
  analystEstimates: { rating: string; targetMean: number; targetHigh: number; targetLow: number; count: number } | null;
  related: string[];
}

export interface FinancialPeriod {
  period: string; // e.g. "FY2024" or "Q1 2025"
  values: Record<string, number>;
}

export interface Filing {
  id: string;
  symbol: string;
  type: string; // 10-K, 10-Q, 8-K ...
  title: string;
  filedAt: string;
  url: string;
  sample: boolean;
}

export interface PriceBookLevel {
  price: number;
  quantity: number; // resting shares at the level
}

/** Level 2 order book snapshot — empty sides mean no resting liquidity (e.g. market closed). */
export interface PriceBook extends Provenance {
  symbol: string;
  bids: PriceBookLevel[];
  asks: PriceBookLevel[];
}

/** Market-wide upcoming earnings report. */
export interface EarningsEvent extends Provenance {
  symbol: string;
  date: string; // ISO date
  timing: string; // "am" | "pm"
  epsEstimate: number | null;
  epsActual: number | null;
}
