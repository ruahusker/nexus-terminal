// Yahoo fundamentals adapter — real financial statements, earnings, analyst data.
// Statements come from the keyless fundamentals-timeseries API; profile,
// earnings calendar, and analyst targets from quoteSummary (crumb-gated).
// Anything Yahoo doesn't have is left empty/zero — never invented.

import type { FinancialPeriod, Fundamentals } from "../types";
import { fetchQuoteSummary, toYahooSymbol } from "./yahoo";
import { ProviderError } from "./errors";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) NEXUS-Terminal/1.0";
const TS_BASE = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";

// ─── fundamentals-timeseries (keyless) ──────────────────────────────────────

const STATEMENT_TYPES = {
  income: [
    ["Revenue", "annualTotalRevenue"],
    ["Gross Profit", "annualGrossProfit"],
    ["Operating Income", "annualOperatingIncome"],
    ["Net Income", "annualNetIncome"],
    ["Diluted EPS", "annualDilutedEPS"],
  ],
  balance: [
    ["Cash & Equivalents", "annualCashCashEquivalentsAndShortTermInvestments"],
    ["Total Assets", "annualTotalAssets"],
    ["Total Debt", "annualTotalDebt"],
    ["Shareholders' Equity", "annualStockholdersEquity"],
  ],
  cashflow: [
    ["Operating Cash Flow", "annualOperatingCashFlow"],
    ["Capital Expenditure", "annualCapitalExpenditure"],
    ["Free Cash Flow", "annualFreeCashFlow"],
  ],
} as const;

interface TsPoint {
  asOfDate?: string;
  reportedValue?: { raw?: number };
}

type TsSeries = Record<string, { date: string; value: number }[]>;

async function fetchStatementSeries(symbol: string): Promise<TsSeries> {
  const types = Object.values(STATEMENT_TYPES)
    .flat()
    .map(([, t]) => t)
    .join(",");
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 7 * 366 * 86_400; // ~7y back so 4 annual reports survive gaps
  const url = `${TS_BASE}/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${period1}&period2=${period2}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ProviderError(`Yahoo timeseries network error: ${String(err)}`, "upstream");
  }
  if (res.status === 429) throw new ProviderError("Yahoo timeseries rate limit (429)", "rate_limit");
  if (!res.ok) throw new ProviderError(`Yahoo timeseries HTTP ${res.status}`, "upstream");
  const json = (await res.json()) as { timeseries?: { result?: Record<string, TsPoint[] | unknown>[] } };
  const out: TsSeries = {};
  for (const item of json.timeseries?.result ?? []) {
    for (const [key, points] of Object.entries(item)) {
      if (key === "meta" || key === "timestamp" || !Array.isArray(points)) continue;
      out[key] = points
        .map((p) => ({ date: p.asOfDate ?? "", value: Number(p.reportedValue?.raw) }))
        .filter((p) => p.date && Number.isFinite(p.value));
    }
  }
  return out;
}

/** Assemble FinancialPeriod[] (FY-labeled, ascending) from one statement's line items. */
function toPeriods(items: readonly (readonly [string, string])[], series: TsSeries): FinancialPeriod[] {
  const dates = new Set<string>();
  for (const [, type] of items) for (const p of series[type] ?? []) dates.add(p.date);
  const sorted = [...dates].sort().slice(-4); // last 4 fiscal years
  return sorted.map((date) => {
    const values: Record<string, number> = {};
    for (const [label, type] of items) {
      const point = (series[type] ?? []).find((p) => p.date === date);
      if (point) values[label] = point.value;
    }
    return { period: `FY${date.slice(0, 4)}`, values };
  });
}

// ─── quoteSummary mapping (crumb-gated) ─────────────────────────────────────

const raw = (v: unknown): number | null => {
  const n = Number((v as { raw?: unknown } | null)?.raw);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = (v as { fmt?: unknown } | null)?.fmt;
  return typeof s === "string" && s ? s : null;
};

const RATINGS: Record<string, string> = {
  strong_buy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong Sell",
};

interface EarningsEntry {
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
  surprise: number | null;
}

function mapEarnings(qs: Record<string, unknown> | null): EarningsEntry[] {
  if (!qs) return [];
  const out: EarningsEntry[] = [];
  const history = (qs.earningsHistory as { history?: Record<string, unknown>[] } | undefined)?.history ?? [];
  for (const h of history.slice(-4)) {
    const date = str(h.quarter);
    if (!date) continue;
    const est = raw(h.epsEstimate);
    const act = raw(h.epsActual);
    const surprise =
      raw(h.surprisePercent) ?? (est != null && act != null && est !== 0 ? (act - est) / Math.abs(est) : null);
    out.push({ date, epsEstimate: est, epsActual: act, surprise });
  }
  const next = (qs.calendarEvents as { earnings?: Record<string, unknown> } | undefined)?.earnings;
  const nextDate = (next?.earningsDate as unknown[] | undefined)?.map(str).find(Boolean);
  if (nextDate) {
    out.push({ date: nextDate, epsEstimate: raw(next?.earningsAverage), epsActual: null, surprise: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function mapAnalyst(qs: Record<string, unknown> | null): Fundamentals["analystEstimates"] {
  const fd = qs?.financialData as Record<string, unknown> | undefined;
  const targetMean = raw(fd?.targetMeanPrice);
  if (targetMean == null) return null;
  const key = typeof fd?.recommendationKey === "string" ? fd.recommendationKey : "";
  return {
    rating: RATINGS[key] ?? "—",
    targetMean,
    targetHigh: raw(fd?.targetHighPrice) ?? targetMean,
    targetLow: raw(fd?.targetLowPrice) ?? targetMean,
    count: raw(fd?.numberOfAnalystOpinions) ?? 0,
  };
}

function mapProfile(symbol: string, qs: Record<string, unknown> | null): Fundamentals["profile"] {
  const ap = qs?.assetProfile as Record<string, unknown> | undefined;
  const hq = [ap?.city, ap?.state, ap?.country]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(", ");
  return {
    description:
      (typeof ap?.longBusinessSummary === "string" && ap.longBusinessSummary) ||
      `${symbol} — profile text not available from the data provider.`,
    sector: (typeof ap?.sector === "string" && ap.sector) || "—",
    industry: (typeof ap?.industry === "string" && ap.industry) || "—",
    employees: typeof ap?.fullTimeEmployees === "number" ? ap.fullTimeEmployees : 0,
    headquarters: hq || "—",
    founded: 0, // Yahoo does not publish founding year
    website: (typeof ap?.website === "string" && ap.website) || "",
  };
}

// ─── Public adapter ─────────────────────────────────────────────────────────

export async function getYahooFundamentals(symbol: string): Promise<Fundamentals> {
  const sym = toYahooSymbol(symbol.trim().toUpperCase());
  // Statements are the core payload; quoteSummary degrades gracefully under
  // rate limiting (empty profile/earnings rather than failing the whole panel).
  const [series, qs] = await Promise.all([
    fetchStatementSeries(sym),
    fetchQuoteSummary(sym, ["assetProfile", "calendarEvents", "earningsHistory", "financialData"]).catch(() => null),
  ]);
  return {
    provider: "yahoo",
    status: "DELAYED",
    asOf: new Date().toISOString(),
    symbol: symbol.toUpperCase(),
    profile: mapProfile(symbol.toUpperCase(), qs),
    incomeStatement: toPeriods(STATEMENT_TYPES.income, series),
    balanceSheet: toPeriods(STATEMENT_TYPES.balance, series),
    cashFlow: toPeriods(STATEMENT_TYPES.cashflow, series),
    earningsCalendar: mapEarnings(qs),
    analystEstimates: mapAnalyst(qs),
    related: [], // filled by the facade from the universe
  };
}
