// Tests for the Robinhood MCP provider — global fetch is mocked; a temp token
// file stands in for the real OAuth token.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "rh-test-"));
const tokenPath = join(dir, "token.json");

process.env.ROBINHOOD_MCP_TOKEN_PATH = tokenPath;

// Imported after the env var is set (TOKEN_PATH is captured at module load).
const { robinhood } = await import("@/lib/providers/robinhood");
const { ProviderError } = await import("@/lib/providers/errors");

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function writeToken(accessToken: string) {
  writeFileSync(tokenPath, JSON.stringify({ tokens: { access_token: accessToken } }), { mode: 0o600 });
}

interface Call {
  method: string;
  tool?: string;
  args?: Record<string, unknown>;
  auth: string | null;
  sessionId: string | null;
}
const calls: Call[] = [];

/** Queue a tools/call result keyed by tool name; unlisted tools throw. */
let toolResults: Record<string, unknown> = {};
let failFirstWith401 = false;
let onFirst401: (() => void) | null = null;
let sseResponses = false;

function jsonResponse(body: unknown, init: { status?: number; sessionId?: string; sse?: boolean } = {}): Response {
  const headers = new Headers();
  if (init.sessionId) headers.set("mcp-session-id", init.sessionId);
  if (init.sse) {
    headers.set("content-type", "text/event-stream");
    return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: init.status ?? 200, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function handleRequest(body: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }): Response {
  if (failFirstWith401) {
    failFirstWith401 = false;
    onFirst401?.();
    return new Response("unauthorized", { status: 401 });
  }
  if (body.method === "initialize") {
    return jsonResponse(
      { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "rh", version: "1" } } },
      { sessionId: "sess-1", sse: sseResponses },
    );
  }
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: { "mcp-session-id": "sess-1" } });
  }
  if (body.method === "tools/call") {
    const name = body.params?.name ?? "";
    const result = toolResults[name];
    if (result === undefined) {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ text: `unexpected tool ${name}` }] } }, { sse: sseResponses });
    }
    if (result instanceof Error) {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ text: result.message }] } }, { sse: sseResponses });
    }
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result: { structuredContent: result } }, { sse: sseResponses });
  }
  throw new Error(`unexpected method ${body.method}`);
}

beforeAll(() => {
  fetchMock = vi.fn(async (_url: unknown, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Parameters<typeof handleRequest>[0];
    calls.push({
      method: body.method ?? "",
      tool: body.params?.name,
      args: body.params?.arguments,
      auth: init.headers["Authorization"] ?? null,
      sessionId: init.headers["mcp-session-id"] ?? null,
    });
    return handleRequest(body);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls.length = 0;
  toolResults = {};
  failFirstWith401 = false;
  sseResponses = false;
  writeToken("token-a");
});

const equityQuotePayload = {
  data: {
    results: [
      {
        quote: {
          symbol: "SPY",
          last_trade_price: "746.810000",
          venue_last_trade_time: "2026-07-31T19:59:59Z",
          last_non_reg_trade_price: "744.278500",
          venue_last_non_reg_trade_time: "2026-07-31T23:59:54Z",
          previous_close: "741.690000",
          bid_price: "743.910000",
          ask_price: "744.600000",
          state: "active",
        },
      },
    ],
  },
};

const fundamentalsPayload = {
  data: {
    results: [
      {
        symbol: "SPY",
        open: "742.0",
        high: "747.5",
        low: "741.0",
        volume: "12345678.0",
        average_volume: "58675416.0",
        high_52_weeks: "760.5",
        low_52_weeks: "480.2",
        market_cap: "4538847222000.0",
        pe_ratio: "35.4",
        description: "SPDR S&P 500 ETF Trust.",
      },
    ],
  },
};

describe("robinhood.getQuote", () => {
  it("maps quotes, preferring the fresher non-regular price", async () => {
    toolResults = { get_equity_quotes: equityQuotePayload, get_equity_fundamentals: fundamentalsPayload };
    const q = await robinhood.getQuote("SPY");
    expect(q.provider).toBe("robinhood");
    expect(q.status).toBe("REALTIME");
    expect(q.price).toBeCloseTo(744.2785); // non-reg venue time is newer
    expect(q.prevClose).toBeCloseTo(741.69);
    expect(q.bid).toBeCloseTo(743.91);
    expect(q.open).toBeCloseTo(742.0);
    expect(q.high).toBeCloseTo(747.5);
    expect(q.volume).toBe(12345678);
    expect(q.avgVolume).toBe(58675416);
    expect(q.week52High).toBeCloseTo(760.5);
    expect(q.week52Low).toBeCloseTo(480.2);
    expect(calls[0].method).toBe("initialize");
    expect(calls[0].auth).toBe("Bearer token-a");
    expect(calls.find((c) => c.tool === "get_equity_quotes")?.sessionId).toBe("sess-1");
  });

  it("prefers the regular price when its venue time is newer", async () => {
    const payload = structuredClone(equityQuotePayload);
    payload.data.results[0].quote.venue_last_trade_time = "2026-08-01T20:00:00Z";
    toolResults = { get_equity_quotes: payload, get_equity_fundamentals: fundamentalsPayload };
    const q = await robinhood.getQuote("SPY");
    expect(q.price).toBeCloseTo(746.81);
  });

  it("parses SSE-framed responses", async () => {
    sseResponses = true;
    toolResults = { get_equity_quotes: equityQuotePayload, get_equity_fundamentals: fundamentalsPayload };
    const q = await robinhood.getQuote("SPY");
    expect(q.price).toBeCloseTo(744.2785);
  });

  it("re-reads the token file and retries once on 401", async () => {
    failFirstWith401 = true;
    onFirst401 = () => writeToken("token-b"); // simulate the external refresher rotating the token
    toolResults = { get_equity_quotes: equityQuotePayload, get_equity_fundamentals: fundamentalsPayload };
    const q = await robinhood.getQuote("SPY");
    expect(q.price).toBeCloseTo(744.2785);
    const inits = calls.filter((c) => c.method === "initialize");
    expect(inits.length).toBe(2);
    expect(inits[1].auth).toBe("Bearer token-b");
    onFirst401 = null;
  });

  it("throws ProviderError when the tool reports an error", async () => {
    toolResults = { get_equity_quotes: new Error("unknown symbol") };
    await expect(robinhood.getQuote("NOPE")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("robinhood.getBars", () => {
  const histPayload = {
    data: {
      results: [
        {
          bars: [
            { begins_at: "2026-07-31T14:00:00Z", open_price: "1", high_price: "2", low_price: "0.5", close_price: "1.5", volume: 10 },
            { begins_at: "2026-07-31T14:05:00Z", open_price: "1.5", high_price: "3", low_price: "1.5", close_price: "2.5", volume: 20 },
            { begins_at: "2026-07-31T14:10:00Z", open_price: "2.5", high_price: "4", low_price: "2", close_price: "3.5", volume: 30 },
          ],
        },
      ],
    },
  };

  it("maps historical bars", async () => {
    toolResults = { get_equity_historicals: histPayload };
    const bars = await robinhood.getBars("SPY", "5m", 1);
    expect(bars.length).toBe(3);
    expect(bars[0].time).toBe(Math.floor(new Date("2026-07-31T14:00:00Z").getTime() / 1000));
    expect(bars[1].close).toBeCloseTo(2.5);
    expect(calls.find((c) => c.tool === "get_equity_historicals")?.args?.interval).toBe("5minute");
  });

  it("aggregates 5m bars into 15m", async () => {
    toolResults = { get_equity_historicals: histPayload };
    const bars = await robinhood.getBars("SPY", "15m", 1);
    expect(bars.length).toBe(1);
    expect(bars[0].open).toBeCloseTo(1);
    expect(bars[0].high).toBeCloseTo(4);
    expect(bars[0].low).toBeCloseTo(0.5);
    expect(bars[0].close).toBeCloseTo(3.5);
    expect(bars[0].volume).toBe(60);
  });
});

describe("robinhood.getOptionsChain", () => {
  const chainsPayload = { data: { chains: [{ expiration_dates: ["2026-08-21", "2026-09-18"] }] } };
  const instrumentsPayload = {
    data: {
      instruments: [
        { id: "id-call", expiration_date: "2026-08-21", strike_price: "740.0000", type: "call" },
        { id: "id-put", expiration_date: "2026-08-21", strike_price: "740.0000", type: "put" },
      ],
      next: null,
    },
  };
  const optionQuotesPayload = {
    data: {
      results: [
        {
          quote: {
            instrument_id: "id-call",
            bid_price: "10.10",
            ask_price: "10.40",
            mark_price: "10.25",
            previous_close_price: "9.90",
            implied_volatility: "0.25",
            delta: "0.55",
            gamma: "0.01",
            theta: "-0.05",
            vega: "0.30",
            rho: "0.10",
            open_interest: 5000,
            volume: 1200,
            updated_at: "2026-08-01T19:00:00Z",
          },
        },
        {
          quote: {
            instrument_id: "id-put",
            bid_price: "8.00",
            ask_price: "8.30",
            mark_price: "8.15",
            previous_close_price: "8.50",
            implied_volatility: "0.27",
            delta: "-0.45",
            gamma: "0.01",
            theta: "-0.04",
            vega: "0.29",
            rho: "-0.08",
            open_interest: 4000,
            volume: 900,
            updated_at: "2026-08-01T19:00:00Z",
          },
        },
      ],
    },
  };

  it("maps a full chain with real IV and greeks", async () => {
    toolResults = {
      get_equity_quotes: equityQuotePayload,
      get_equity_fundamentals: fundamentalsPayload,
      get_option_chains: chainsPayload,
      get_option_instruments: instrumentsPayload,
      get_option_quotes: optionQuotesPayload,
    };
    const chain = await robinhood.getOptionsChain("SPY");
    expect(chain.provider).toBe("robinhood");
    expect(chain.status).toBe("REALTIME");
    expect(chain.expiry).toBe("2026-08-21");
    expect(chain.expiries).toEqual(["2026-08-21", "2026-09-18"]);
    expect(chain.underlyingPrice).toBeCloseTo(744.2785);
    expect(chain.contracts.length).toBe(2);
    const callC = chain.contracts.find((c) => c.type === "CALL");
    expect(callC?.strike).toBe(740);
    expect(callC?.iv).toBeCloseTo(0.25);
    expect(callC?.delta).toBeCloseTo(0.55);
    expect(callC?.mid).toBeCloseTo(10.25);
    expect(callC?.openInterest).toBe(5000);
    expect(chain.expectedMove.absolute).toBeGreaterThan(0);
  });

  it("honors a requested expiry", async () => {
    toolResults = {
      get_equity_quotes: equityQuotePayload,
      get_equity_fundamentals: fundamentalsPayload,
      get_option_chains: chainsPayload,
      get_option_instruments: instrumentsPayload,
      get_option_quotes: optionQuotesPayload,
    };
    await robinhood.getOptionsChain("SPY", "2026-09-18");
    expect(calls.find((c) => c.tool === "get_option_instruments")?.args?.expiration_dates).toBe("2026-09-18");
  });
});


describe("robinhood.getQuotes (batch)", () => {
  it("maps and enriches multiple symbols in one session", async () => {
    const twoSymbols = {
      data: {
        results: [
          equityQuotePayload.data.results[0],
          {
            quote: {
              symbol: "AAPL",
              last_trade_price: "307.36",
              venue_last_trade_time: "2026-07-31T20:00:00Z",
              last_non_reg_trade_price: "",
              venue_last_non_reg_trade_time: "",
              previous_close: "333.43",
              bid_price: "307.30",
              ask_price: "307.35",
              state: "closed",
            },
          },
        ],
      },
    };
    const twoFunds = {
      data: {
        results: [
          fundamentalsPayload.data.results[0],
          { symbol: "AAPL", open: "330.0", high: "334.0", low: "305.0", volume: "999.0", average_volume: "500.0", high_52_weeks: "344.5", low_52_weeks: "201.5" },
        ],
      },
    };
    toolResults = { get_equity_quotes: twoSymbols, get_equity_fundamentals: twoFunds };
    const qs = await robinhood.getQuotes(["SPY", "AAPL"]);
    expect(qs.length).toBe(2);
    expect(qs[0]?.symbol).toBe("SPY");
    expect(qs[1]?.price).toBeCloseTo(307.36);
    expect(qs[1]?.week52High).toBeCloseTo(344.5);
    expect(qs[1]?.avgVolume).toBe(500);
    // one session for the whole batch
    expect(calls.filter((c) => c.method === "initialize").length).toBe(1);
  });
});

describe("robinhood.getFundamentals", () => {
  it("maps profile, income periods, and earnings results", async () => {
    toolResults = {
      get_equity_fundamentals: fundamentalsPayload,
      get_financials: {
        data: {
          results: [
            {
              financials: [
                { fiscal_year: 2025, fiscal_quarter: null, revenue: "416161000000", gross_profit: "195201000000", net_income: "112010000000", net_margin: "26.92" },
                { fiscal_year: 2024, fiscal_quarter: null, revenue: "391035000000", gross_profit: "180683000000", net_income: "93736000000", net_margin: "23.97" },
              ],
            },
          ],
        },
      },
      get_earnings_results: {
        data: {
          results: [
            { eps: { estimate: "1.42", actual: "1.57" }, report: { date: "2025-07-31" } },
            { eps: { estimate: "2.34", actual: "2.40" }, report: { date: "2025-01-30" } },
          ],
        },
      },
    };
    const f = await robinhood.getFundamentals("SPY");
    expect(f.provider).toBe("robinhood");
    expect(f.profile.description).toContain("SPDR");
    expect(f.incomeStatement.length).toBe(2);
    expect(f.incomeStatement[0]?.period).toBe("FY2025");
    expect(f.incomeStatement[0]?.values.Revenue).toBe(416161000000);
    expect(f.balanceSheet.length).toBe(0); // facade fills from Yahoo
    expect(f.earningsCalendar.length).toBe(2);
    expect(f.earningsCalendar[0]?.date).toBe("2025-01-30"); // sorted ascending
    expect(f.earningsCalendar[0]?.surprise).toBeCloseTo((2.4 - 2.34) / 2.34, 5);
  });
});

describe("robinhood.getIndexQuotes", () => {
  const indexesPayload = {
    data: { indexes: [{ id: "idx-spx", symbol: "SPX" }, { id: "idx-vix", symbol: "VIX" }] },
  };
  const indexQuotesPayload = {
    data: { quotes: [{ instrument_id: "idx-spx", symbol: "SPX", value: "7489.72", venue_timestamp: "2026-07-31T17:22:12-04:00" }] },
  };
  const indexHistPayload = {
    data: {
      results: [
        {
          bars: [
            { begins_at: "2026-07-30T00:00:00Z", open_value: "7390.0", high_value: "7448.0", low_value: "7370.0", close_value: "7400.0" },
            { begins_at: "2026-07-31T00:00:00Z", open_value: "7462.0", high_value: "7512.0", low_value: "7399.0", close_value: "7450.0" },
            // interpolated weekend filler — must be ignored
            { begins_at: "2026-08-01T00:00:00Z", open_value: "7462.0", high_value: "7512.0", low_value: "7399.0", close_value: "7450.0", interpolated: true },
          ],
        },
      ],
    },
  };

  it("maps index levels with previous close from historicals", async () => {
    toolResults = { get_indexes: indexesPayload, get_index_quotes: indexQuotesPayload, get_index_historicals: indexHistPayload };
    const qs = await robinhood.getIndexQuotes(["SPX"]);
    expect(qs.length).toBe(1);
    const q = qs[0];
    expect(q?.provider).toBe("robinhood");
    expect(q?.price).toBeCloseTo(7489.72);
    expect(q?.prevClose).toBeCloseTo(7400.0); // second-to-last daily bar
    expect(q?.changePct).toBeCloseTo((7489.72 - 7400) / 7400, 5);
  });

  it("throws not_found for indexes the MCP does not serve", async () => {
    toolResults = { get_indexes: indexesPayload };
    await expect(robinhood.getIndexQuotes(["DJI"])).rejects.toBeInstanceOf(ProviderError);
  });
});
