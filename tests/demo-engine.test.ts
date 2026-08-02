import { describe, expect, it } from "vitest";
import { getQuote, dailyBars, getOptionsChain, getNews, searchInstruments, getMarketOverview, getScreenerRows } from "@/lib/demo/engine";

describe("demo engine", () => {
  it("quotes are deterministic for a fixed timestamp", () => {
    const at = new Date("2025-06-15T15:00:00Z");
    const a = getQuote("AAPL", at);
    const b = getQuote("AAPL", at);
    expect(a.price).toBe(b.price);
    expect(a.status).toBe("SAMPLE");
    expect(a.provider).toBe("demo");
  });

  it("quote fields are internally consistent", () => {
    const q = getQuote("AAPL", new Date("2025-06-15T15:00:00Z"));
    expect(q.bid).toBeLessThanOrEqual(q.price);
    expect(q.ask).toBeGreaterThanOrEqual(q.price);
    expect(q.high).toBeGreaterThanOrEqual(q.low);
    expect(q.week52High).toBeGreaterThanOrEqual(q.week52Low);
    expect(q.changePct).toBeCloseTo(q.change / q.prevClose, 8);
  });

  it("crypto trades 24/7, equities have sessions", () => {
    const sunday = new Date("2025-06-15T15:00:00Z"); // a Sunday
    expect(getQuote("BTC", sunday).marketState).toBe("ALWAYS");
    expect(getQuote("AAPL", sunday).marketState).toBe("CLOSED");
  });

  it("daily bars are ordered and OHLC-consistent", () => {
    const bars = dailyBars("MSFT", 60);
    expect(bars.length).toBe(60);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.time).toBeGreaterThan(bars[i - 1]!.time);
    }
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
      expect(b.volume).toBeGreaterThan(0);
    }
  });

  it("options chain has calls and puts around the underlying", () => {
    const chain = getOptionsChain("AAPL");
    expect(chain.contracts.length).toBeGreaterThan(20);
    expect(chain.expiries).toContain(chain.expiry);
    const calls = chain.contracts.filter((c) => c.type === "CALL");
    const puts = chain.contracts.filter((c) => c.type === "PUT");
    expect(calls.length).toBe(puts.length);
    for (const c of chain.contracts) {
      expect(c.bid).toBeLessThanOrEqual(c.ask);
      expect(c.iv).toBeGreaterThan(0);
      expect(c.openInterest).toBeGreaterThanOrEqual(0);
      if (c.type === "CALL") expect(c.delta).toBeGreaterThan(0);
      else expect(c.delta).toBeLessThan(0);
    }
    expect(chain.expectedMove.absolute).toBeGreaterThan(0);
  });

  it("news items are always labeled sample", () => {
    const news = getNews({ limit: 20 });
    expect(news.length).toBeGreaterThan(0);
    for (const n of news) expect(n.sample).toBe(true);
  });

  it("symbol-specific news contains the symbol or general stories", () => {
    const news = getNews({ symbol: "NVDA", limit: 10 });
    expect(news.length).toBeGreaterThan(0);
    for (const n of news) {
      expect(n.symbols.length === 0 || n.symbols.includes("NVDA")).toBe(true);
    }
  });

  it("search ranks exact matches first and groups by class", () => {
    const r = searchInstruments("AAPL");
    expect(r[0]?.symbol).toBe("AAPL");
    expect(searchInstruments("").length).toBe(0);
    expect(searchInstruments("bitcoin")[0]?.symbol).toBe("BTC");
  });

  it("market overview has all sections populated", () => {
    const m = getMarketOverview();
    expect(m.indexes.length).toBeGreaterThanOrEqual(8);
    expect(m.treasuries.length).toBe(5);
    expect(m.crypto.length).toBeGreaterThan(0);
    expect(m.sectors.length).toBeGreaterThan(5);
    expect(m.gainers[0]!.changePct).toBeGreaterThanOrEqual(m.losers[0]!.changePct);
    expect(m.status).toBe("SAMPLE");
  });

  it("screener rows cover stocks and ETFs with nullable fields handled", () => {
    const rows = getScreenerRows();
    expect(rows.length).toBeGreaterThan(80);
    for (const r of rows) {
      expect(r.price).toBeGreaterThan(0);
      expect(r.week52High).toBeGreaterThanOrEqual(r.week52Low);
    }
  });
});
