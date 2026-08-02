// ─── AI tool surface ────────────────────────────────────────────────────────
// The tools the Kimi agent can call. Every executor goes through the provider
// facade (Robinhood/Yahoo/Coinbase per routing) and returns a trimmed payload
// to keep the context small — full fidelity lives in the terminal screens.

import { facade } from "../providers";
import type { ToolDef } from "./kimi";

const num = (v: unknown, dp = 2): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(dp)) : 0;
};

function trimQuote(q: { symbol: string; price: number; changePct: number; bid: number; ask: number; volume: number; marketState: string; asOf: string }) {
  return {
    symbol: q.symbol,
    price: num(q.price),
    changePct: num(q.changePct * 100),
    bid: num(q.bid),
    ask: num(q.ask),
    volume: q.volume,
    marketState: q.marketState,
    asOf: q.asOf,
  };
}

export const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_market_overview",
      description: "Snapshot of global markets: index levels, crypto, commodities, FX, most active / gainers / losers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_quotes",
      description: "Real-time quotes for up to 20 symbols (stocks, ETFs, crypto like BTC/ETH, indexes like SPX/NDX).",
      parameters: {
        type: "object",
        properties: { symbols: { type: "array", items: { type: "string" }, description: "Ticker symbols, uppercase" } },
        required: ["symbols"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bars",
      description: "OHLCV bars for a symbol. Use 1d/1y for a 200-day moving average, 1d/6M for pullbacks, 1h/5D for intraday.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          interval: { type: "string", enum: ["1h", "1d", "1wk"] },
          range: { type: "string", enum: ["5D", "1M", "3M", "6M", "1Y", "2Y"] },
        },
        required: ["symbol", "interval", "range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_screener",
      description: "All tracked stocks with sector, market cap, PE ratio, price, day change, volume, and 52-week high/low. Filter client-side for screens like 'high PE stocks that pulled back 15% from their 52-week high'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fundamentals",
      description: "Fundamentals for one stock: profile, valuation, annual income statement, earnings history, analyst targets.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_options_chain",
      description: "Options chain around the money for a symbol: expirations, and ±10 strikes with bid/ask/IV/greeks for one expiry.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          expiry: { type: "string", description: "YYYY-MM-DD; omit for nearest" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_news",
      description: "Latest market news headlines, optionally filtered by symbol or topic.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          q: { type: "string", description: "Free-text topic filter" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_instruments",
      description: "Resolve a name or partial ticker to tradable symbols.",
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
    },
  },
];

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_market_overview": {
      const m = await facade.getMarketOverview();
      const brief = (qs: typeof m.indexes) => qs.slice(0, 12).map(trimQuote);
      return {
        indexes: brief(m.indexes),
        crypto: brief(m.crypto),
        commodities: brief(m.commodities),
        mostActive: brief(m.mostActive),
        gainers: brief(m.gainers),
        losers: brief(m.losers),
        asOf: m.asOf,
      };
    }
    case "get_quotes": {
      const symbols = (Array.isArray(args.symbols) ? args.symbols : []).map((s) => String(s).toUpperCase()).slice(0, 20);
      return (await facade.getQuotes(symbols)).map(trimQuote);
    }
    case "get_bars": {
      const bars = await facade.getBars(String(args.symbol ?? "").toUpperCase(), String(args.interval ?? "1d") as "1d", String(args.range ?? "1Y"));
      return bars.slice(-260).map((b) => ({ t: b.time, o: num(b.open), h: num(b.high), l: num(b.low), c: num(b.close), v: b.volume }));
    }
    case "get_screener": {
      const rows = await facade.getScreenerRows();
      return rows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        sector: r.sector,
        marketCap: r.marketCap,
        peRatio: r.peRatio,
        price: num(r.price),
        changePct: num(r.changePct * 100),
        volume: r.volume,
        week52High: r.week52High,
        week52Low: r.week52Low,
        pctOff52wkHigh: r.week52High > 0 ? num(((r.price - r.week52High) / r.week52High) * 100) : null,
      }));
    }
    case "get_fundamentals": {
      const f = await facade.getFundamentals(String(args.symbol ?? "").toUpperCase());
      return {
        provider: f.provider,
        asOf: f.asOf,
        profile: { description: f.profile.description.slice(0, 400), sector: f.profile.sector, industry: f.profile.industry },
        incomeStatement: f.incomeStatement.slice(0, 4),
        earningsCalendar: f.earningsCalendar.slice(-6),
        analystEstimates: f.analystEstimates,
      };
    }
    case "get_options_chain": {
      const c = await facade.getOptionsChain(String(args.symbol ?? "").toUpperCase(), args.expiry ? String(args.expiry) : undefined);
      const near = c.contracts
        .filter((x) => Math.abs(x.strike - c.underlyingPrice) / c.underlyingPrice <= 0.15)
        .sort((a, b) => Math.abs(a.strike - c.underlyingPrice) - Math.abs(b.strike - c.underlyingPrice))
        .slice(0, 20);
      return {
        provider: c.provider,
        asOf: c.asOf,
        underlyingPrice: num(c.underlyingPrice),
        expiries: c.expiries.slice(0, 12),
        expiry: c.expiry,
        expectedMovePct: num(c.expectedMove.pct * 100),
        contracts: near.map((x) => ({
          type: x.type, strike: x.strike, bid: num(x.bid), ask: num(x.ask),
          iv: num(x.iv * 100), delta: num(x.delta, 3), volume: x.volume, openInterest: x.openInterest,
        })),
      };
    }
    case "get_news": {
      const items = await facade.getNews({
        symbol: args.symbol ? String(args.symbol).toUpperCase() : undefined,
        q: args.q ? String(args.q) : undefined,
        limit: 10,
      });
      return items.map((n) => ({ headline: n.headline, source: n.source, publishedAt: n.publishedAt, symbols: n.symbols }));
    }
    case "search_instruments": {
      const results = await facade.search(String(args.q ?? ""));
      return results.slice(0, 10).map((i) => ({ symbol: i.symbol, name: i.name, assetClass: i.assetClass }));
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
