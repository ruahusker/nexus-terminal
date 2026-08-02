// ─── Provider adapter layer ─────────────────────────────────────────────────
// The UI talks only to this facade. Two modes:
//   demo     — everything from the deterministic demo engine (zero network)
//   provider — real adapters per capability; anything without a working
//              provider falls back to LABELED demo data (SAMPLE status) and
//              adapter failures surface as explicit errors — never silently.
//
// Capability routing in provider mode:
//   quotes:   CRYPTO → Coinbase · STOCK/ETF → Robinhood (Yahoo fallback) ·
//             INDEX → Robinhood for SPX/NDX/VIX (Yahoo for the rest) · FX/FUTURE → Yahoo
//   bars:     STOCK/ETF → Robinhood (Massive, then Yahoo fallbacks) · INDEX → Robinhood
//             (Yahoo fallback) · CRYPTO → Coinbase · FX/FUTURE → Yahoo
//   options:  Robinhood (real chains, real IV + greeks) when configured; otherwise Yahoo
//             (real chains, real IV; greeks derived via Black-Scholes),
//             labeled demo fallback when both fail
//   news:     RSS (Yahoo Finance / CNBC / MarketWatch)
//   filings:  SEC EDGAR
//   economy:  FRED (series + release calendar) when FRED_API_KEY is set
//   screener: real Yahoo quotes over universe metadata
//   fundamentals: Robinhood (profile/valuation, income periods, EPS results) with
//             Yahoo filling what the MCP doesn't publish (balance sheet, cash flow,
//             analyst targets); labeled SAMPLE fallback when both fail

import type {
  Bar, BarInterval, EarningsEvent, EconEvent, EconSeries, Filing, Fundamentals, InstrumentInfo,
  MarketOverview, NewsItem, OptionsChain, PriceBook, Quote, ScreenerRow,
} from "../types";
import * as demo from "../demo/engine";
import { lookup, UNIVERSE_MAP, type UniverseEntry } from "../demo/universe";
import { massive } from "./massive";
import { coinbase } from "./coinbase";
import { yahoo, searchSymbols } from "./yahoo";
import { getYahooFundamentals } from "./yahooFundamentals";
import { rssNews } from "./news";
import { edgar } from "./edgar";
import { fred } from "./fred";
import { robinhood } from "./robinhood";
import { ProviderError } from "./errors";

export function dataMode(): "demo" | "provider" {
  return process.env.NEXUS_DATA_MODE === "provider" ? "provider" : "demo";
}

// ── Tiny in-memory server cache with TTL ──
const cache = new Map<string, { value: unknown; expires: number }>();
export function cached<T>(key: string, ttlMs: number, fn: () => T): T {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
export async function cachedAsync<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  // Don't let a transient provider failure poison the cache for the full TTL.
  value.catch(() => cache.delete(key));
  return value;
}
const QUOTE_TTL = Number(process.env.NEXUS_QUOTE_CACHE_MS ?? 5_000);
const CRYPTO_QUOTE_TTL = 3_000; // Coinbase is public and high-limit — stream-friendly
const RANGE_DAYS: Record<string, number> = {
  "1D": 1, "5D": 5, "1M": 31, "3M": 93, "6M": 186, "1Y": 366, "2Y": 732, "5Y": 1830, MAX: 3650,
};

function toInfo(u: UniverseEntry): InstrumentInfo {
  return {
    symbol: u.symbol, name: u.name, assetClass: u.assetClass, exchange: u.exchange,
    currency: u.currency, sector: u.sector ?? null, industry: u.industry ?? null,
    country: u.country, marketCap: u.marketCap ?? null, sharesOut: u.sharesOut ?? null,
    dividendYield: u.dividendYield ?? null, peRatio: u.peRatio ?? null, beta: u.beta ?? null,
    description: u.description ?? null, optionable: u.optionable ?? false,
  };
}

/** Same-sector universe peers — reference metadata, used as "related" symbols. */
function relatedPeers(symbol: string): string[] {
  const u = lookup(symbol);
  if (!u?.sector) return [];
  return [...UNIVERSE_MAP.values()]
    .filter((x) => x.sector === u.sector && x.symbol !== u.symbol && x.assetClass === "STOCK")
    .slice(0, 6)
    .map((x) => x.symbol);
}

function liveQuote(symbol: string, u: UniverseEntry): Promise<Quote> {
  switch (u.assetClass) {
    case "CRYPTO":
      return cachedAsync(`cq:${symbol}`, CRYPTO_QUOTE_TTL, () => coinbase.getQuote(symbol));
    case "INDEX":
      return cachedAsync(`iq:${symbol}`, QUOTE_TTL, async () => {
        if (robinhood.isConfigured()) {
          try {
            const q = await robinhood.getIndexQuote(symbol);
            q.marketState = demo.marketState(u);
            return q;
          } catch {
            // Index not served by the MCP (DJI/RUT/FTSE…) or outage — Yahoo.
          }
        }
        const q = await yahoo.getQuote(symbol);
        q.marketState = demo.marketState(u);
        return q;
      });
    default: {
      // STOCK / ETF / FX / FUTURE; session state from the venue calendar.
      // Robinhood is preferred for STOCK/ETF real-time quotes when configured.
      return cachedAsync(`yq:${symbol}`, QUOTE_TTL, async () => {
        if ((u.assetClass === "STOCK" || u.assetClass === "ETF") && robinhood.isConfigured()) {
          try {
            const q = await robinhood.getQuote(symbol);
            q.marketState = demo.marketState(u);
            return q;
          } catch {
            // Robinhood outage or token issue — fall through to Yahoo.
          }
        }
        const q = await yahoo.getQuote(symbol);
        q.marketState = demo.marketState(u);
        return q;
      });
    }
  }
}

/** Unknown symbols resolve as equities — Yahoo serves any US ticker. */
function liveQuoteUnknown(symbol: string): Promise<Quote> {
  return cachedAsync(`yq:${symbol}`, QUOTE_TTL, () => yahoo.getQuote(symbol));
}

/** STOCK/ETF bars: Robinhood primary when configured, then Massive, then Yahoo. */
function equityBars(symbol: string, interval: BarInterval, range: string): Promise<Bar[]> {
  const days = RANGE_DAYS[range] ?? 366;
  const yahooBars = () => yahoo.getBars(symbol, interval, range as Parameters<typeof yahoo.getBars>[2]);
  const massiveBars = (): Promise<Bar[]> => {
    if (!massive.isConfigured()) {
      return cachedAsync(`yb:${symbol}:${interval}:${range}`, 300_000, yahooBars);
    }
    return cachedAsync(`mb:${symbol}:${interval}:${range}`, 300_000, async () => {
      try {
        return await massive.getBars(symbol, interval, days);
      } catch (err) {
        // Unknown ticker or a Massive outage — Yahoo is the real-data fallback.
        if (err instanceof ProviderError && (err.kind === "not_found" || err.kind === "upstream")) {
          return yahooBars();
        }
        throw err;
      }
    });
  };
  if (!robinhood.isConfigured()) return massiveBars();
  return cachedAsync(`rb:${symbol}:${interval}:${range}`, 300_000, async () => {
    try {
      return await robinhood.getBars(symbol, interval, days);
    } catch {
      return massiveBars(); // token issue or outage — Massive/Yahoo chain
    }
  });
}

function liveBars(symbol: string, u: UniverseEntry, interval: BarInterval, range: string): Promise<Bar[]> {
  switch (u.assetClass) {
    case "STOCK":
    case "ETF":
      return equityBars(symbol, interval, range);
    case "CRYPTO":
      return cachedAsync(`cb:${symbol}:${interval}:${range}`, 300_000, () => coinbase.getBars(symbol, interval, RANGE_DAYS[range] ?? 366));
    case "INDEX":
      if (robinhood.isConfigured()) {
        return cachedAsync(`rib:${symbol}:${interval}:${range}`, 300_000, async () => {
          try {
            return await robinhood.getIndexBars(symbol, interval, RANGE_DAYS[range] ?? 366);
          } catch {
            return yahoo.getBars(symbol, interval, range as Parameters<typeof yahoo.getBars>[2]);
          }
        });
      }
      return cachedAsync(`yb:${symbol}:${interval}:${range}`, 300_000, () =>
        yahoo.getBars(symbol, interval, range as Parameters<typeof yahoo.getBars>[2]),
      );
    default:
      return cachedAsync(`yb:${symbol}:${interval}:${range}`, 300_000, () =>
        yahoo.getBars(symbol, interval, range as Parameters<typeof yahoo.getBars>[2]),
      );
  }
}

export const facade = {
  mode: dataMode,

  getInstrument(symbol: string): InstrumentInfo | null {
    const u = lookup(symbol);
    return u ? toInfo(u) : null;
  },

  getQuote(symbol: string): Quote | Promise<Quote> {
    if (dataMode() === "demo") return cached(`q:${symbol}`, QUOTE_TTL, () => demo.getQuote(symbol));
    const u = lookup(symbol);
    if (!u) return liveQuoteUnknown(symbol);
    return liveQuote(symbol, u);
  },

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (dataMode() === "demo") return symbols.map((s) => demo.getQuote(s));
    const out = new Map<string, Quote>();
    const resolve = async (s: string) => {
      const u = lookup(s);
      try {
        out.set(s, u ? await liveQuote(s, u) : await liveQuoteUnknown(s));
      } catch {
        // A symbol its provider can't serve is omitted, not fatal to the batch.
      }
    };
    // STOCK/ETF quotes come back in one batched Robinhood session when configured.
    const rhSet = new Set(
      robinhood.isConfigured()
        ? symbols.filter((s) => {
            const a = lookup(s)?.assetClass;
            return a === "STOCK" || a === "ETF";
          })
        : [],
    );
    // Indexes the MCP serves (SPX/NDX/VIX) batch through Robinhood too.
    const idxSet = new Set(
      robinhood.isConfigured() ? symbols.filter((s) => lookup(s)?.assetClass === "INDEX") : [],
    );
    const rest = symbols.filter((s) => !rhSet.has(s) && !idxSet.has(s));
    const rhBatch = (async () => {
      if (rhSet.size > 0) {
        const rhSyms = [...rhSet];
        try {
          const qs = await cachedAsync(`rq:${rhSyms.slice().sort().join(",")}`, QUOTE_TTL, () => robinhood.getQuotes(rhSyms));
          for (const q of qs) {
            const u = lookup(q.symbol);
            if (u) q.marketState = demo.marketState(u);
            out.set(q.symbol, q);
          }
        } catch {
          // Batch failed — fall back to per-symbol resolution (Robinhood→Yahoo each).
          for (let i = 0; i < rhSyms.length; i += 4) {
            await Promise.all(rhSyms.slice(i, i + 4).map(resolve));
          }
        }
      }
      if (idxSet.size > 0) {
        const idxSyms = [...idxSet];
        try {
          const qs = await cachedAsync(`riq:${idxSyms.slice().sort().join(",")}`, QUOTE_TTL, () => robinhood.getIndexQuotes(idxSyms));
          for (const q of qs) {
            const u = lookup(q.symbol);
            if (u) q.marketState = demo.marketState(u);
            out.set(q.symbol, q);
          }
        } catch {
          // RH index path down — per-symbol fallback below.
        }
        // Indexes the MCP doesn't serve (DJI, RUT…) resolve via Yahoo.
        const missing = idxSyms.filter((s) => !out.has(s));
        for (let i = 0; i < missing.length; i += 4) {
          await Promise.all(missing.slice(i, i + 4).map(resolve));
        }
      }
    })();
    // Small batches — be polite to the keyless Yahoo endpoint.
    for (let i = 0; i < rest.length; i += 4) {
      await Promise.all(rest.slice(i, i + 4).map(resolve));
    }
    await rhBatch;
    return symbols.map((s) => out.get(s)).filter((q): q is Quote => q != null);
  },

  getBars(symbol: string, interval: BarInterval, range: string): Bar[] | Promise<Bar[]> {
    if (dataMode() === "demo") return cached(`b:${symbol}:${interval}:${range}`, 60_000, () => demo.getBars(symbol, interval, range));
    const u = lookup(symbol);
    if (!u) return equityBars(symbol, interval, range);
    return liveBars(symbol, u, interval, range);
  },

  search(q: string): InstrumentInfo[] | Promise<InstrumentInfo[]> {
    const local = demo.searchInstruments(q).map(toInfo);
    if (dataMode() === "demo") return local;
    return cachedAsync(`ys:${q.toUpperCase()}`, 60_000, async () => {
      let remote: InstrumentInfo[] = [];
      try {
        remote = await searchSymbols(q);
      } catch {
        // search degrades to local universe on provider failure
      }
      const seen = new Set(local.map((i) => i.symbol));
      return [...local, ...remote.filter((i) => !seen.has(i.symbol))].slice(0, 24);
    });
  },

  /** Universe-first instrument resolution; falls back to a live quote for any ticker. */
  async resolveInstrument(symbol: string): Promise<InstrumentInfo | null> {
    const u = lookup(symbol);
    if (u) return toInfo(u);
    if (dataMode() === "provider") {
      try {
        const q = await yahoo.getQuote(symbol);
        return {
          symbol: q.symbol, name: q.name ?? q.symbol, assetClass: "STOCK",
          exchange: "", currency: "USD", optionable: true, // chain attempt will confirm
        };
      } catch {
        return null;
      }
    }
    return null;
  },

  getOptionsChain(symbol: string, expiry?: string): OptionsChain | Promise<OptionsChain> {
    if (dataMode() === "provider") {
      return cachedAsync(`oc:${symbol}:${expiry ?? ""}`, 60_000, async () => {
        if (robinhood.isConfigured()) {
          try {
            return await robinhood.getOptionsChain(symbol, expiry);
          } catch {
            // Robinhood failure — fall through to Yahoo.
          }
        }
        try {
          return await yahoo.getOptionsChain(symbol, expiry);
        } catch {
          // Yahoo's options endpoint is crumb-gated and rate-limited; a failure
          // falls back to LABELED sample data rather than an error panel.
          return demo.getOptionsChain(symbol, expiry);
        }
      });
    }
    return cached(`oc:${symbol}:${expiry ?? ""}`, 60_000, () => demo.getOptionsChain(symbol, expiry));
  },

  async getMarketOverview(): Promise<MarketOverview> {
    if (dataMode() === "demo") return cached("mkt:overview", QUOTE_TTL, () => demo.getMarketOverview());
    return cachedAsync("mkt:live", QUOTE_TTL, () => buildLiveOverview());
  },

  getNews(opts: { symbol?: string; topic?: string; q?: string; limit?: number }): NewsItem[] | Promise<NewsItem[]> {
    if (dataMode() === "demo") return cached(`news:${JSON.stringify(opts)}`, 120_000, () => demo.getNews(opts));
    return cachedAsync(`rnews:${JSON.stringify(opts)}`, 300_000, () => rssNews.getNews(opts));
  },

  async getScreenerRows(): Promise<ScreenerRow[]> {
    if (dataMode() === "demo") {
      return cached("screener:rows", QUOTE_TTL, () => demo.getScreenerRows()).map((r) => ({
        ...r, provider: "demo", status: "SAMPLE" as const,
      }));
    }
    // Real quotes for every universe row. Fields with no free source
    // (margins, ROE, RSI, IV, options volume/OI) are nulled, never faked;
    // PE/yield/beta remain universe reference data.
    return cachedAsync("screener:live", 300_000, async () => {
      const rows = demo.getScreenerRows();
      const quotes = new Map((await facade.getQuotes(rows.map((r) => r.symbol))).map((q) => [q.symbol, q]));
      return rows.map((r) => {
        const q = quotes.get(r.symbol);
        return {
          ...r,
          provider: q ? q.provider : "demo",
          status: (q ? q.status : "SAMPLE") as ScreenerRow["status"],
          price: q?.price ?? r.price,
          changePct: q?.changePct ?? r.changePct,
          volume: q?.volume ?? r.volume,
          // Yahoo has no average-volume field; 52-week range only when served.
          // 0 means "no data" here — never backfilled with demo values.
          avgVolume: q?.avgVolume ?? 0,
          week52High: q?.week52High ?? 0,
          week52Low: q?.week52Low ?? 0,
          grossMargin: null,
          revenueGrowth: null,
          roe: null,
          rsi14: null,
          iv30: null,
          optVolume: null,
          optOpenInterest: null,
        };
      });
    });
  },

  getFundamentals(symbol: string): Fundamentals | Promise<Fundamentals> {
    const u = lookup(symbol);
    if (dataMode() === "demo") {
      if (!u) throw new ProviderError(`Unknown symbol: ${symbol}`, "not_found");
      return cached(`fund:${symbol}`, 300_000, () => demo.getFundamentals(symbol));
    }
    // Manual cache: the TTL depends on whether the Yahoo gap-fill landed
    // (short TTL so the next load picks it up, long when fully merged).
    const key = `fund:${symbol}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as Fundamentals;
    const finish = (f: Fundamentals): Fundamentals => {
      if (u) {
        f.profile.sector ||= u.sector ?? "";
        f.profile.industry ||= u.industry ?? "";
      }
      f.related = relatedPeers(symbol);
      return f;
    };
    const compute = async (): Promise<{ value: Fundamentals; ttl: number }> => {
      if (robinhood.isConfigured()) {
        // Robinhood is authoritative; Yahoo fills the sections the MCP does
        // not publish (balance sheet, cash flow, analyst targets, profile
        // metadata). Yahoo starts immediately but is given a 6s budget —
        // its crumb gate can stall 15-20s and must not hold the panel hostage.
        const yfPromise = getYahooFundamentals(symbol).catch(() => null);
        const rh = await robinhood.getFundamentals(symbol).catch(() => null);
        if (rh) {
          const yf = await Promise.race([
            yfPromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
          ]);
          if (yf) {
            rh.provider = "robinhood+yahoo";
            if (rh.incomeStatement.length === 0) rh.incomeStatement = yf.incomeStatement;
            rh.balanceSheet = yf.balanceSheet;
            rh.cashFlow = yf.cashFlow;
            rh.analystEstimates = yf.analystEstimates;
            if (rh.earningsCalendar.length === 0) rh.earningsCalendar = yf.earningsCalendar;
            rh.profile = { ...yf.profile, description: rh.profile.description || yf.profile.description };
          }
          return { value: finish(rh), ttl: yf ? 900_000 : 60_000 };
        }
        // Robinhood can't serve this symbol (e.g. delisted) — Yahoo is the
        // only real source, so wait for it in full.
        const yf = await yfPromise;
        if (yf) return { value: finish(yf), ttl: 900_000 };
      } else {
        try {
          const f = await getYahooFundamentals(symbol);
          return { value: finish(f), ttl: 900_000 };
        } catch {
          // labeled fallback below
        }
      }
      if (u) return { value: demo.getFundamentals(symbol), ttl: 300_000 }; // labeled SAMPLE fallback
      // Outside the demo universe and the provider can't serve it: return an
      // explicit empty payload, never invented numbers.
      return {
        ttl: 60_000,
        value: {
          provider: "none", status: "DELAYED", asOf: new Date().toISOString(), symbol,
          profile: {
            description: `${symbol} is outside the built-in universe and the data provider returned no fundamentals. Price, chart, news, and filings may still be live.`,
            sector: "—", industry: "—", employees: 0, headquarters: "—", founded: 0, website: "",
          },
          incomeStatement: [], balanceSheet: [], cashFlow: [],
          earningsCalendar: [], analystEstimates: null, related: [],
        },
      };
    };
    return compute().then(({ value, ttl }) => {
      cache.set(key, { value, expires: Date.now() + ttl });
      return value;
    });
  },

  getFilings(symbol: string): Filing[] | Promise<Filing[]> {
    if (dataMode() === "demo") return cached(`filings:${symbol}`, 300_000, () => demo.getFilings(symbol));
    return cachedAsync(`efil:${symbol}`, 900_000, () => edgar.getFilings(symbol));
  },

  /** Level 2 order book — Robinhood only; empty SAMPLE book in demo mode. */
  getPriceBook(symbol: string): PriceBook | Promise<PriceBook> {
    if (dataMode() === "demo") {
      return { provider: "demo", status: "SAMPLE", asOf: new Date().toISOString(), symbol, bids: [], asks: [] };
    }
    return cachedAsync(`book:${symbol}`, 10_000, async () => {
      if (!robinhood.isConfigured()) throw new ProviderError("Level 2 book requires the Robinhood provider", "config");
      return robinhood.getPriceBook(symbol);
    });
  },

  /** Market-wide earnings calendar — Robinhood in provider mode; universe-derived in demo. */
  getEarningsCalendar(days = 7): EarningsEvent[] | Promise<EarningsEvent[]> {
    if (dataMode() === "demo") {
      return cached(`earncal:${days}`, 300_000, () => {
        const today = new Date().toISOString().slice(0, 10);
        const end = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
        const asOf = new Date().toISOString();
        const out: EarningsEvent[] = [];
        for (const sym of [...UNIVERSE_MAP.keys()]) {
          try {
            for (const e of demo.getFundamentals(sym).earningsCalendar) {
              if (e.date >= today && e.date <= end) {
                out.push({
                  provider: "demo", status: "SAMPLE", asOf,
                  symbol: sym, date: e.date, timing: "", epsEstimate: e.epsEstimate, epsActual: e.epsActual,
                });
              }
            }
          } catch { /* symbol without fundamentals */ }
        }
        return out.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)).slice(0, 120);
      });
    }
    return cachedAsync(`earncal:${days}`, 900_000, async () => {
      if (!robinhood.isConfigured()) throw new ProviderError("Earnings calendar requires the Robinhood provider", "config");
      return robinhood.getEarningsCalendar(days);
    });
  },

  getEconCalendar(): EconEvent[] | Promise<EconEvent[]> {
    if (dataMode() === "provider" && fred.isConfigured()) {
      return cachedAsync("econ:cal:fred", 900_000, async () => {
        try {
          return await fred.getEconCalendar();
        } catch {
          return demo.getEconCalendar().map((e) => ({ ...e, provider: "demo", status: "SAMPLE" as const }));
        }
      });
    }
    return cached("econ:cal", 300_000, () =>
      demo.getEconCalendar().map((e) => ({ ...e, provider: "demo", status: "SAMPLE" as const })),
    );
  },

  getEconSeries(id: string): EconSeries | null | Promise<EconSeries | null> {
    if (dataMode() === "provider" && fred.isConfigured()) {
      return cachedAsync(`econ:fred:${id}`, 900_000, async () => {
        try {
          return await fred.getEconSeries(id);
        } catch {
          return demo.getEconSeries(id); // labeled SAMPLE fallback
        }
      });
    }
    return cached(`econ:${id}`, 300_000, () => demo.getEconSeries(id));
  },

  listEconSeries() {
    if (dataMode() === "provider" && fred.isConfigured()) {
      return cachedAsync("econ:list:fred", 900_000, async () => {
        try {
          const rows = await fred.listEconSeries();
          if (rows.length > 0) return rows;
        } catch {
          // fall through to labeled demo
        }
        return demo.listEconSeries().map((s) => ({ ...s, provider: "demo", status: "SAMPLE" as const }));
      });
    }
    return cached("econ:list", 300_000, () =>
      demo.listEconSeries().map((s) => ({ ...s, provider: "demo", status: "SAMPLE" as const })),
    );
  },

  listSymbols(): string[] {
    return [...UNIVERSE_MAP.keys()];
  },
};

// ─── Live market overview assembly ──────────────────────────────────────────
// Quotes are real (per-quote provenance preserved). Treasuries, breadth, and
// VIX-term fields have no free source — those sections come from the demo
// engine and the whole payload is labeled DELAYED/multi; the UI shows the
// per-quote provenance on each row.

async function buildLiveOverview(): Promise<MarketOverview> {
  const base = demo.getMarketOverview(); // structure + demo-only sections
  const indexSyms = ["SPX", "NDX", "DJI", "RUT", "FTSE", "DAX", "N225", "HSI"];
  const yahooSyms = [...indexSyms, "CL", "NG", "GC", "SI", "HG", "ZW", "EURUSD", "GBPUSD", "USDJPY", "DXY", "VIX"];
  const cryptoSyms = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA"];
  const sectorSyms = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLY", "XLC", "XLU", "XLRE", "XLB"];
  const moverSyms = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "JPM", "AMD", "PLTR", "COIN"];
  // Real treasury yields via Yahoo indexes: ^IRX 13wk, ^FVX 5Y, ^TNX 10Y, ^TYX 30Y.
  // Yahoo quotes these as direct yield percentages (4.745 = 4.745%).
  const TREASURY_MAP: [string, string, number][] = [["3M", "IRX", 1], ["5Y", "FVX", 1], ["10Y", "TNX", 1], ["30Y", "TYX", 1]];

  const settle = <T,>(r: PromiseSettledResult<T[]>): T[] => (r.status === "fulfilled" ? r.value : []);
  const resilient = (syms: string[]) =>
    Promise.all(
      syms.map((s) => {
        const u = lookup(s);
        return (u ? liveQuote(s, u) : liveQuoteUnknown(s)).catch(() => null);
      }),
    ).then((qs) => qs.filter((q): q is Quote => q != null));
  const [yahooQuotes, cryptoQuotes, sectorQuotes, stockQuotes, treasuryQuotes] = (
    await Promise.allSettled([
      resilient(yahooSyms),
      resilient(cryptoSyms),
      resilient(sectorSyms),
      resilient(moverSyms),
      resilient(TREASURY_MAP.map(([, s]) => s)),
    ])
  ).map(settle) as [Quote[], Quote[], Quote[], Quote[], Quote[]];

  const tq = new Map(treasuryQuotes.map((q) => [q.symbol, q]));
  // Real curve when Yahoo serves it; the demo curve is the labeled fallback.
  const treasuries = TREASURY_MAP.flatMap(([tenor, sym, divisor]) => {
    const q = tq.get(sym);
    return q && q.price > 0
      ? [{ tenor, yield: Math.round((q.price / divisor) * 100) / 100, changeBps: Math.round((q.change / divisor) * 100) }]
      : [];
  });

  const yq = new Map(yahooQuotes.map((q) => [q.symbol, q]));
  const take = (syms: string[], fallback: Quote[]): Quote[] =>
    syms.map((s, i) => yq.get(s) ?? (fallback[i] as Quote));

  const sectors = sectorQuotes.length > 0
    ? sectorQuotes
        .map((q) => ({ name: (UNIVERSE_MAP.get(q.symbol)?.sector ?? q.symbol), changePct: q.changePct }))
        .sort((a, b) => b.changePct - a.changePct)
    : base.sectors;

  const movers = stockQuotes.length > 0 ? [...stockQuotes] : base.mostActive;
  const sorted = [...movers].sort((a, b) => b.changePct - a.changePct);
  const vix = yq.get("VIX");

  return {
    ...base,
    provider: "multi(yahoo,coinbase,massive,demo)",
    status: "DELAYED",
    asOf: new Date().toISOString(),
    indexes: take(indexSyms, base.indexes),
    treasuries: treasuries.length > 0 ? treasuries : base.treasuries,
    commodities: take(["CL", "NG", "GC", "SI", "HG", "ZW"], base.commodities),
    fx: take(["EURUSD", "GBPUSD", "USDJPY", "DXY"], base.fx),
    crypto: cryptoQuotes.length > 0 ? cryptoQuotes : base.crypto,
    sectors,
    mostActive: movers.slice(0, 10),
    gainers: sorted.slice(0, 10),
    losers: sorted.slice(-10).reverse(),
    volatility: [
      { symbol: "VIX", name: "S&P 500 Volatility", value: vix?.price ?? base.volatility[0]?.value ?? 0, changePct: vix?.changePct ?? 0 },
      ...(base.volatility[1] ? [base.volatility[1]] : []),
    ],
  };
}
