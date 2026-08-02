// ─── Robinhood MCP provider ─────────────────────────────────────────────────
// Real-time equity quotes, options chains, and equity bars via the user's
// Robinhood MCP access (https://agent.robinhood.com/mcp/trading, MCP
// streamable-HTTP). READ-ONLY market data: no account or order tools are used.
//
// Auth: Bearer access_token read from the token file (default
// /home/main/trading/.secrets/robinhood_mcp_oauth.json, override with
// ROBINHOOD_MCP_TOKEN_PATH). Token refresh is owned by the /trading
// overnight-quote-logger service — we never refresh (refresh_token rotation
// would race it); on a 401 we simply re-read the file once and retry.

import { readFileSync } from "node:fs";
import { expectedMove } from "../blackScholes";
import type {
  Bar, BarInterval, EarningsEvent, Fundamentals, OptionContract, OptionsChain, PriceBook, PriceBookLevel, Quote,
} from "../types";
import { ProviderError } from "./errors";

const MCP_URL = process.env.ROBINHOOD_MCP_URL ?? "https://agent.robinhood.com/mcp/trading";
const TOKEN_PATH = process.env.ROBINHOOD_MCP_TOKEN_PATH ?? "/home/main/trading/.secrets/robinhood_mcp_oauth.json";

function readToken(): string | null {
  try {
    const raw = JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as { tokens?: { access_token?: string } };
    return raw.tokens?.access_token || null;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return readToken() != null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Signals an auth rejection so withSession can re-read the token and retry once. */
class Unauthorized extends Error {}

// ── Minimal MCP streamable-HTTP client ──

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** Parse an SSE body, returning the JSON-RPC message with the matching id. */
function parseSse(body: string, id?: number): JsonRpc | null {
  let found: JsonRpc | null = null;
  for (const event of body.split("\n\n")) {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim()) as JsonRpc;
        if (id == null || msg.id === id) found = msg;
      } catch {
        // non-JSON data line — ignore
      }
    }
  }
  return found;
}

async function rpc(token: string, sessionId: string | null, msg: JsonRpc, timeoutMs: number): Promise<{ body: JsonRpc | null; sessionId: string | null }> {
  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError(`Robinhood MCP network error: ${String(err)}`, "upstream");
  }
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new ProviderError(`Robinhood MCP HTTP ${res.status}`, "upstream");
  const sid = res.headers.get("mcp-session-id") ?? sessionId;
  if (res.status === 202) return { body: null, sessionId: sid }; // notification accepted
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    return { body: parseSse(await res.text(), msg.id), sessionId: sid };
  }
  return { body: (await res.json()) as JsonRpc, sessionId: sid };
}

type ToolCall = (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Open one MCP session, run fn with a tools/call closure, retry once on 401. */
async function withSession<T>(fn: (call: ToolCall) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = readToken();
    if (!token) throw new ProviderError("Robinhood MCP token unavailable — is the /trading logger running?", "config");
    try {
      const init = await rpc(token, null, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "nexus-terminal", version: "1.0.0" } },
      }, 30_000);
      const sid = init.sessionId;
      await rpc(token, sid, { jsonrpc: "2.0", method: "notifications/initialized" }, 15_000);
      let nextId = 2;
      const call: ToolCall = async (tool, args) => {
        const r = await rpc(token, sid, { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: tool, arguments: args } }, 60_000);
        if (r.body?.error) throw new ProviderError(`Robinhood ${tool}: ${r.body.error.message ?? "RPC error"}`, "upstream");
        const result = r.body?.result as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text?: string }[] } | undefined;
        if (!result) throw new ProviderError(`Robinhood ${tool}: empty result`, "upstream");
        if (result.isError) {
          const msg = (result.content ?? []).map((c) => c.text ?? "").join(" ").trim() || "tool error";
          throw new ProviderError(`Robinhood ${tool}: ${msg}`, "upstream");
        }
        if (result.structuredContent) return result.structuredContent;
        for (const item of result.content ?? []) {
          if (item.text) {
            try {
              return JSON.parse(item.text) as Record<string, unknown>;
            } catch {
              return { text: item.text };
            }
          }
        }
        return {};
      };
      return await fn(call);
    } catch (err) {
      if (err instanceof Unauthorized && attempt === 0) continue; // token rotated — re-read & retry once
      if (err instanceof Unauthorized) throw new ProviderError("Robinhood MCP auth rejected (401)", "config");
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Robinhood MCP: ${String(err)}`, "upstream");
    }
  }
  throw new ProviderError("Robinhood MCP auth failed", "config");
}

// ── Equity quotes ──

interface RhEquityQuote {
  symbol?: string;
  last_trade_price?: string;
  venue_last_trade_time?: string;
  last_non_reg_trade_price?: string;
  venue_last_non_reg_trade_time?: string;
  previous_close?: string;
  bid_price?: string;
  ask_price?: string;
  state?: string;
}

interface RhBar {
  begins_at?: string;
  open_price?: string; // equity bars use *_price …
  high_price?: string;
  low_price?: string;
  close_price?: string;
  open_value?: string; // … index bars use *_value
  high_value?: string;
  low_value?: string;
  close_value?: string;
  interpolated?: boolean; // index bars: non-trading-day filler duplicating the last close
  volume?: number;
}

function toBar(b: RhBar): Bar {
  return {
    time: Math.floor(new Date(b.begins_at ?? 0).getTime() / 1000),
    open: num(b.open_price ?? b.open_value),
    high: num(b.high_price ?? b.high_value),
    low: num(b.low_price ?? b.low_value),
    close: num(b.close_price ?? b.close_value),
    volume: num(b.volume),
  };
}

/** The MCP pads historicals with all-zero bars for non-trading days — drop them. */
function nonZeroBars(raw: RhBar[]): Bar[] {
  return raw.map(toBar).filter((b) => b.open !== 0 || b.high !== 0 || b.low !== 0 || b.close !== 0);
}

/** For index historicals: drop zero bars and interpolated non-trading-day filler. */
function realIndexBars(raw: RhBar[]): Bar[] {
  return raw.filter((b) => !b.interpolated).map(toBar).filter((b) => b.open !== 0 || b.high !== 0 || b.low !== 0 || b.close !== 0);
}

/** Freshest of the regular / non-regular last trade prices, and which venue it came from. */
function freshestPrice(q: RhEquityQuote): { price: number; at: string; session: "REGULAR" | "EXTENDED" } {
  const reg = { price: num(q.last_trade_price), at: q.venue_last_trade_time ?? "" };
  const nonReg = { price: num(q.last_non_reg_trade_price), at: q.venue_last_non_reg_trade_time ?? "" };
  if (reg.price > 0 && reg.at >= nonReg.at) return { ...reg, session: "REGULAR" };
  if (nonReg.price > 0) return { ...nonReg, session: "EXTENDED" };
  return reg.price > 0 ? { ...reg, session: "REGULAR" } : { price: 0, at: new Date().toISOString(), session: "REGULAR" };
}

// ── Equity fundamentals (day OHLC, volume, averages, 52wk, valuation) ──
// Served by get_equity_fundamentals; changes intraday but slowly — cache 15m.

interface RhFundamentals {
  symbol?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  average_volume?: string;
  high_52_weeks?: string;
  low_52_weeks?: string;
  market_cap?: string;
  pe_ratio?: string;
  pb_ratio?: string;
  shares_outstanding?: string;
  float?: string;
  dividend_yield?: string;
  description?: string;
}

const fundCache = new Map<string, { value: RhFundamentals | null; expires: number }>();
const FUND_TTL = 900_000;

/** Fundamentals for a batch of symbols (chunks of 10), cached per symbol. */
async function equityFundamentals(call: ToolCall, symbols: string[]): Promise<Map<string, RhFundamentals>> {
  const out = new Map<string, RhFundamentals>();
  const missing: string[] = [];
  for (const s of symbols) {
    const hit = fundCache.get(s);
    if (hit && hit.expires > Date.now()) {
      if (hit.value) out.set(s, hit.value);
    } else {
      missing.push(s);
    }
  }
  for (let i = 0; i < missing.length; i += 10) {
    const chunk = missing.slice(i, i + 10);
    try {
      const p = await call("get_equity_fundamentals", { symbols: chunk });
      const results = ((p?.data as Record<string, unknown>)?.results as (RhFundamentals | null)[] | undefined) ?? [];
      for (const f of results) {
        if (f?.symbol) {
          fundCache.set(f.symbol, { value: f, expires: Date.now() + FUND_TTL });
          out.set(f.symbol, f);
        }
      }
    } catch {
      // enrichment is best-effort — never fails the quotes themselves
    }
    for (const s of chunk) {
      if (!out.has(s)) fundCache.set(s, { value: null, expires: Date.now() + FUND_TTL });
    }
  }
  return out;
}

function mapEquityQuote(q: RhEquityQuote, fund: RhFundamentals | null): Quote {
  const { price, at, session } = freshestPrice(q);
  const prevClose = num(q.previous_close);
  return {
    provider: "robinhood",
    status: "REALTIME",
    asOf: at || new Date().toISOString(),
    symbol: q.symbol ?? "",
    price,
    priceSession: session,
    change: price - prevClose,
    changePct: prevClose > 0 ? (price - prevClose) / prevClose : 0,
    bid: num(q.bid_price),
    ask: num(q.ask_price),
    open: num(fund?.open) || prevClose,
    high: num(fund?.high) || Math.max(price, prevClose),
    low: num(fund?.low) || Math.min(price, prevClose),
    prevClose,
    volume: num(fund?.volume),
    avgVolume: num(fund?.average_volume),
    week52High: num(fund?.high_52_weeks),
    week52Low: num(fund?.low_52_weeks),
    marketState: q.state === "active" ? "REGULAR" : "CLOSED", // facade overrides from the venue calendar
  };
}

async function quoteFromCall(call: ToolCall, symbol: string, enrich = true): Promise<Quote> {
  const payload = await call("get_equity_quotes", { symbols: [symbol] });
  const entry = ((payload?.data as Record<string, unknown>)?.results as { quote?: RhEquityQuote }[] | undefined)?.[0];
  const q = entry?.quote;
  if (!q?.symbol) throw new ProviderError(`Robinhood: no quote for ${symbol}`, "not_found");
  const fund = enrich ? (await equityFundamentals(call, [symbol])).get(symbol) ?? null : null;
  return mapEquityQuote(q, fund);
}

export async function getQuote(symbol: string): Promise<Quote> {
  return withSession((call) => quoteFromCall(call, symbol));
}

/** Batched quotes — one MCP session, up to 10 symbols per tool call. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  return withSession(async (call) => {
    const out: Quote[] = [];
    for (let i = 0; i < symbols.length; i += 10) {
      const payload = await call("get_equity_quotes", { symbols: symbols.slice(i, i + 10) });
      const results = ((payload?.data as Record<string, unknown>)?.results as { quote?: RhEquityQuote }[] | undefined) ?? [];
      for (const entry of results) {
        if (entry.quote?.symbol) out.push(mapEquityQuote(entry.quote, null));
      }
    }
    if (out.length === 0) throw new ProviderError("Robinhood: no quotes in batch", "upstream");
    const funds = await equityFundamentals(call, out.map((q) => q.symbol));
    return out.map((q) => {
      const f = funds.get(q.symbol);
      if (!f) return q;
      return {
        ...q,
        open: num(f.open) || q.open,
        high: num(f.high) || q.high,
        low: num(f.low) || q.low,
        volume: num(f.volume),
        avgVolume: num(f.average_volume),
        week52High: num(f.high_52_weeks),
        week52Low: num(f.low_52_weeks),
      };
    });
  });
}

// ── Bars ──

const INTERVAL_MAP: Record<BarInterval, string> = {
  "1m": "minute",
  "5m": "5minute",
  "15m": "5minute", // no 15minute interval — aggregated below
  "1h": "hour",
  "1d": "day",
  "1wk": "week",
};

function aggregate(bars: Bar[], n: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += n) {
    const group = bars.slice(i, i + n);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    out.push({
      time: first.time,
      open: first.open,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      close: last.close,
      volume: group.reduce((s, b) => s + b.volume, 0),
    });
  }
  return out;
}

export async function getBars(symbol: string, interval: BarInterval, days: number): Promise<Bar[]> {
  return withSession(async (call) => {
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    // 24_5 includes overnight + pre/post sessions; fall back to extended, then regular.
    let raw: RhBar[] = [];
    let lastErr: unknown = null;
    for (const bounds of ["24_5", "extended", undefined] as const) {
      try {
        const p = await call("get_equity_historicals", {
          symbols: [symbol], start_time: start, interval: INTERVAL_MAP[interval],
          ...(bounds ? { bounds } : {}),
        });
        raw = ((p?.data as Record<string, unknown>)?.results as { bars?: RhBar[] }[] | undefined)?.[0]?.bars ?? [];
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    if (raw.length === 0) throw new ProviderError(`Robinhood: no bars for ${symbol}`, "not_found");
    const bars = nonZeroBars(raw);
    return interval === "15m" ? aggregate(bars, 3) : bars;
  });
}

// ── Options chains ──

interface RhOptionInstrument {
  id?: string;
  expiration_date?: string;
  strike_price?: string;
  type?: string; // "call" | "put"
}

interface RhOptionQuote {
  instrument_id?: string;
  bid_price?: string;
  ask_price?: string;
  mark_price?: string;
  previous_close_price?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
  open_interest?: number;
  volume?: number;
  updated_at?: string;
}

function cursorOf(next: unknown): string | null {
  if (typeof next !== "string" || !next) return null;
  try {
    return new URL(next).searchParams.get("cursor");
  } catch {
    return null;
  }
}

export async function getOptionsChain(symbol: string, expiry?: string): Promise<OptionsChain> {
  return withSession(async (call) => {
    const spot = (await quoteFromCall(call, symbol, false)).price;
    if (!(spot > 0)) throw new ProviderError(`Robinhood: no underlying quote for ${symbol}`, "not_found");

    const ch = await call("get_option_chains", { underlying_symbol: symbol });
    const chain = ((ch?.data as Record<string, unknown>)?.chains as { expiration_dates?: string[] }[] | undefined)?.[0];
    const expirations = chain?.expiration_dates ?? [];
    const firstExpiry = expirations[0];
    if (!firstExpiry) throw new ProviderError(`Robinhood: no options chain for ${symbol}`, "not_found");
    const today = new Date().toISOString().slice(0, 10);
    const chosen = expiry && expirations.includes(expiry) ? expiry : expirations.find((d) => d >= today) ?? firstExpiry;

    // Paginate instruments (pages of 100; cursor comes back in the `next` URL).
    const instruments: RhOptionInstrument[] = [];
    let cursor: string | null = null;
    do {
      const page = await call("get_option_instruments", {
        chain_symbol: symbol,
        expiration_dates: chosen,
        state: "active",
        ...(cursor ? { cursor } : {}),
      });
      const data = page?.data as Record<string, unknown> | undefined;
      instruments.push(...((data?.instruments as RhOptionInstrument[] | undefined) ?? []));
      cursor = cursorOf(data?.next);
    } while (cursor && instruments.length < 3000);
    if (instruments.length === 0) throw new ProviderError(`Robinhood: empty options chain for ${symbol} ${chosen}`, "not_found");

    // Quotes, 20 ids per call (above that the server omits the closes),
    // fetched with bounded concurrency over the shared MCP session.
    const quotes = new Map<string, RhOptionQuote>();
    const ids = instruments.map((i) => i.id).filter((x): x is string => Boolean(x));
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const CONCURRENCY = 6;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const results = await Promise.all(
        chunks.slice(i, i + CONCURRENCY).map(async (chunk) => {
          const qq = await call("get_option_quotes", { instrument_ids: chunk });
          return ((qq?.data as Record<string, unknown>)?.results as { quote?: RhOptionQuote }[] | undefined) ?? [];
        }),
      );
      for (const list of results) {
        for (const r of list) {
          if (r.quote?.instrument_id) quotes.set(r.quote.instrument_id, r.quote);
        }
      }
    }

    const tYears = Math.max(1 / 365, (new Date(chosen + "T20:00:00Z").getTime() - Date.now()) / (365 * 86_400_000));
    const contracts: OptionContract[] = [];
    let latestUpdate = "";
    for (const inst of instruments) {
      const strike = num(inst.strike_price);
      const type = inst.type === "call" ? "CALL" : inst.type === "put" ? "PUT" : null;
      if (!strike || !type || !inst.id) continue;
      const q = quotes.get(inst.id);
      const bid = num(q?.bid_price);
      const ask = num(q?.ask_price);
      const mark = num(q?.mark_price);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : mark;
      if (q?.updated_at && q.updated_at > latestUpdate) latestUpdate = q.updated_at;
      contracts.push({
        symbol,
        expiry: chosen,
        strike,
        type,
        bid,
        ask,
        mid,
        last: mark || num(q?.previous_close_price),
        volume: num(q?.volume),
        openInterest: num(q?.open_interest),
        // Robinhood publishes real per-contract IV and greeks.
        iv: num(q?.implied_volatility),
        delta: num(q?.delta),
        gamma: num(q?.gamma),
        theta: num(q?.theta),
        vega: num(q?.vega),
        rho: num(q?.rho),
        spreadPct: mid > 0 ? Math.max(0, ask - bid) / mid : 0,
      });
    }
    if (contracts.length === 0) throw new ProviderError(`Robinhood: empty options chain for ${symbol} ${chosen}`, "not_found");

    // 1-sigma expected move from the ATM call's IV.
    const atmIv =
      contracts
        .filter((c) => c.type === "CALL" && c.iv > 0)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0]?.iv ?? 0.3;
    const em = expectedMove(spot, atmIv, tYears);
    return {
      provider: "robinhood",
      status: "REALTIME",
      asOf: latestUpdate || new Date().toISOString(),
      symbol,
      underlyingPrice: spot,
      expiries: expirations,
      expiry: chosen,
      contracts,
      expectedMove: { absolute: em, pct: em / spot },
    };
  });
}

// ── Fundamentals (DES panel): profile + income periods + EPS results ──
// Robinhood does not publish balance sheet / cash flow / analyst data —
// the facade fills those sections from Yahoo when available.

interface RhFinancialRow {
  fiscal_year?: number;
  fiscal_quarter?: number | null;
  revenue?: string;
  gross_profit?: string;
  net_income?: string;
  net_margin?: string;
}

interface RhEarningsRow {
  eps?: { estimate?: string; actual?: string };
  report?: { date?: string };
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  return withSession(async (call) => {
    const [funds, finPayload, earnPayload] = await Promise.all([
      equityFundamentals(call, [symbol]),
      call("get_financials", { symbols: [symbol], period: "annual", limit: 4 }).catch(() => null),
      call("get_earnings_results", { symbol }).catch(() => null),
    ]);
    const f = funds.get(symbol);
    if (!f) throw new ProviderError(`Robinhood: no fundamentals for ${symbol}`, "not_found");

    const rows = (((finPayload?.data as Record<string, unknown> | undefined)?.results as { financials?: RhFinancialRow[] }[] | undefined)?.[0]?.financials) ?? [];
    const incomeStatement = rows
      .filter((r) => r.fiscal_year != null)
      .map((r) => ({
        period: r.fiscal_quarter != null ? `Q${r.fiscal_quarter} ${r.fiscal_year}` : `FY${r.fiscal_year}`,
        values: {
          Revenue: num(r.revenue),
          "Gross Profit": num(r.gross_profit),
          "Net Income": num(r.net_income),
          "Net Margin %": num(r.net_margin),
        },
      }));

    const earnRows = ((earnPayload?.data as Record<string, unknown> | undefined)?.results as RhEarningsRow[] | undefined) ?? [];
    const earningsCalendar = earnRows
      .filter((e) => e.report?.date)
      .map((e) => {
        const est = e.eps?.estimate != null && e.eps.estimate !== "" ? num(e.eps.estimate) : null;
        const act = e.eps?.actual != null && e.eps.actual !== "" ? num(e.eps.actual) : null;
        return {
          date: e.report?.date ?? "",
          epsEstimate: est,
          epsActual: act,
          surprise: est != null && act != null && est !== 0 ? (act - est) / Math.abs(est) : null,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      provider: "robinhood",
      status: "DELAYED",
      asOf: new Date().toISOString(),
      symbol,
      profile: {
        description: f.description ?? "",
        sector: "", // not published by the MCP — facade fills from the universe/Yahoo
        industry: "",
        employees: 0,
        headquarters: "",
        founded: 0,
        website: "",
      },
      incomeStatement,
      balanceSheet: [],
      cashFlow: [],
      earningsCalendar,
      analystEstimates: null,
      related: [],
    };
  });
}

// ── Index quotes + bars (SPX / NDX / VIX — the indexes the MCP serves) ──

const INDEX_TTL = 86_400_000; // instrument ids are stable — resolve once a day
let indexIds: { value: Map<string, string>; expires: number } | null = null;

async function indexIdMap(call: ToolCall): Promise<Map<string, string>> {
  if (indexIds && indexIds.expires > Date.now()) return indexIds.value;
  const p = await call("get_indexes", {});
  const list = ((p?.data as Record<string, unknown>)?.indexes as { id?: string; symbol?: string }[] | undefined) ?? [];
  const map = new Map<string, string>();
  for (const ix of list) {
    if (ix.id && ix.symbol) map.set(ix.symbol, ix.id);
  }
  if (map.size === 0) throw new ProviderError("Robinhood: no indexes available", "upstream");
  indexIds = { value: map, expires: Date.now() + INDEX_TTL };
  return map;
}

interface RhIndexQuote {
  instrument_id?: string;
  symbol?: string;
  value?: string;
  venue_timestamp?: string;
  updated_at?: string;
}

// Previous session close per index id — cached an hour.
const indexCloseCache = new Map<string, { value: number; expires: number }>();

async function indexPrevClose(call: ToolCall, id: string): Promise<number> {
  const hit = indexCloseCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = 0;
  try {
    const start = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const p = await call("get_index_historicals", { instrument_ids: [id], start_time: start, interval: "day" });
    const raw = ((p?.data as Record<string, unknown>)?.results as { bars?: RhBar[] }[] | undefined)?.[0]?.bars ?? [];
    const bars = realIndexBars(raw);
    const prev = bars.length >= 2 ? bars[bars.length - 2] : bars[bars.length - 1];
    value = prev?.close ?? 0;
  } catch {
    value = 0;
  }
  indexCloseCache.set(id, { value, expires: Date.now() + 3_600_000 });
  return value;
}

async function indexQuotesFromCall(call: ToolCall, symbols: string[]): Promise<Quote[]> {
  const ids = await indexIdMap(call);
  const requested = symbols.filter((s) => ids.has(s));
  if (requested.length === 0) throw new ProviderError(`Robinhood: indexes not served: ${symbols.join(",")}`, "not_found");
  const p = await call("get_index_quotes", { instrument_ids: requested.map((s) => ids.get(s)) });
  const rows = ((p?.data as Record<string, unknown>)?.quotes as RhIndexQuote[] | undefined) ?? [];
  const out: Quote[] = [];
  for (const r of rows) {
    const symbol = r.symbol ?? "";
    const id = r.instrument_id ?? "";
    const price = num(r.value);
    if (!symbol || !(price > 0)) continue;
    const prevClose = await indexPrevClose(call, id);
    out.push({
      provider: "robinhood",
      status: "REALTIME",
      asOf: r.venue_timestamp || r.updated_at || new Date().toISOString(),
      symbol,
      price,
      change: price - prevClose,
      changePct: prevClose > 0 ? (price - prevClose) / prevClose : 0,
      bid: 0,
      ask: 0,
      open: prevClose,
      high: Math.max(price, prevClose),
      low: Math.min(price, prevClose),
      prevClose,
      volume: 0,
      avgVolume: 0,
      week52High: 0,
      week52Low: 0,
      marketState: "CLOSED", // facade overrides from the venue calendar
    });
  }
  if (out.length === 0) throw new ProviderError("Robinhood: empty index quotes", "upstream");
  return out;
}

export async function getIndexQuotes(symbols: string[]): Promise<Quote[]> {
  return withSession((call) => indexQuotesFromCall(call, symbols));
}

export async function getIndexQuote(symbol: string): Promise<Quote> {
  const qs = await getIndexQuotes([symbol]);
  const q = qs[0];
  if (!q) throw new ProviderError(`Robinhood: no index quote for ${symbol}`, "not_found");
  return q;
}

export async function getIndexBars(symbol: string, interval: BarInterval, days: number): Promise<Bar[]> {
  return withSession(async (call) => {
    const ids = await indexIdMap(call);
    const id = ids.get(symbol);
    if (!id) throw new ProviderError(`Robinhood: index not served: ${symbol}`, "not_found");
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    const p = await call("get_index_historicals", { instrument_ids: [id], start_time: start, interval: INTERVAL_MAP[interval] });
    const raw = ((p?.data as Record<string, unknown>)?.results as { bars?: RhBar[] }[] | undefined)?.[0]?.bars ?? [];
    const bars = realIndexBars(raw);
    if (bars.length === 0) throw new ProviderError(`Robinhood: no index bars for ${symbol}`, "not_found");
    return interval === "15m" ? aggregate(bars, 3) : bars;
  });
}

// ── Level 2 order book (max 4 symbols per call; empty sides when closed) ──

interface RhBookLevel {
  price?: string;
  quantity?: string;
}

export async function getPriceBook(symbol: string): Promise<PriceBook> {
  return withSession(async (call) => {
    const p = await call("get_equity_price_book", { symbols: [symbol] });
    const book = ((p?.data as Record<string, unknown>)?.books as { symbol?: string; updated_at?: string; bids?: RhBookLevel[]; asks?: RhBookLevel[] }[] | undefined)?.[0];
    if (!book?.symbol) throw new ProviderError(`Robinhood: no price book for ${symbol}`, "not_found");
    const levels = (list: RhBookLevel[] | undefined): PriceBookLevel[] =>
      (list ?? []).map((l) => ({ price: num(l.price), quantity: num(l.quantity) })).filter((l) => l.price > 0);
    return {
      provider: "robinhood",
      status: "REALTIME",
      asOf: book.updated_at || new Date().toISOString(),
      symbol: book.symbol,
      bids: levels(book.bids),
      asks: levels(book.asks),
    };
  });
}

// ── Market-wide earnings calendar (up to 31 days out) ──

interface RhEarningsCalRow {
  symbol?: string;
  eps?: { estimate?: string | null; actual?: string | null };
  report?: { date?: string; timing?: string };
}

export async function getEarningsCalendar(days: number): Promise<EarningsEvent[]> {
  return withSession(async (call) => {
    const today = new Date().toISOString().slice(0, 10);
    const p = await call("get_earnings_calendar", { start_date: today, days: Math.min(31, Math.max(1, days)) });
    const rows = ((p?.data as Record<string, unknown>)?.results as RhEarningsCalRow[] | undefined) ?? [];
    const asOf = new Date().toISOString();
    return rows
      .filter((r) => r.symbol && r.report?.date)
      .map((r) => ({
        provider: "robinhood",
        status: "REALTIME" as const,
        asOf,
        symbol: r.symbol ?? "",
        date: r.report?.date ?? "",
        timing: r.report?.timing ?? "",
        epsEstimate: r.eps?.estimate != null && r.eps.estimate !== "" ? num(r.eps.estimate) : null,
        epsActual: r.eps?.actual != null && r.eps.actual !== "" ? num(r.eps.actual) : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  });
}

export const robinhood = { isConfigured, getQuote, getQuotes, getBars, getOptionsChain, getFundamentals, getIndexQuote, getIndexQuotes, getIndexBars, getPriceBook, getEarningsCalendar };
