// FRED adapter (Federal Reserve Bank of St. Louis) — real economic series and
// release calendar. Free API key via FRED_API_KEY. FRED publishes no consensus
// forecasts, so calendar forecast/actual stay null rather than being invented.

import type { EconEvent, EconSeries } from "../types";
import { ProviderError } from "./errors";

const BASE = "https://api.stlouisfed.org/fred";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) NEXUS-Terminal/1.0";

// ─── Indicator series ───────────────────────────────────────────────────────
// App id → FRED series id (+ optional units transform) and display metadata.

interface SeriesSpec {
  fredId: string;
  units?: "pc1" | "pch" | "chg"; // YoY %, MoM %, period change
  name: string;
  category: EconSeries["category"];
  unit: string;
  frequency: EconSeries["frequency"];
}

export const SERIES_SPECS: Record<string, SeriesSpec> = {
  FEDFUNDS: { fredId: "DFF", name: "Effective Federal Funds Rate", category: "RATES", unit: "%", frequency: "DAILY" },
  US10Y: { fredId: "DGS10", name: "US 10-Year Treasury Yield", category: "RATES", unit: "%", frequency: "DAILY" },
  US02Y: { fredId: "DGS2", name: "US 2-Year Treasury Yield", category: "RATES", unit: "%", frequency: "DAILY" },
  CPI_YOY: { fredId: "CPIAUCSL", units: "pc1", name: "US CPI Inflation (YoY)", category: "INFLATION", unit: "%", frequency: "MONTHLY" },
  CORE_PCE: { fredId: "PCEPILFE", units: "pc1", name: "Core PCE Price Index (YoY)", category: "INFLATION", unit: "%", frequency: "MONTHLY" },
  UNRATE: { fredId: "UNRATE", name: "US Unemployment Rate", category: "EMPLOYMENT", unit: "%", frequency: "MONTHLY" },
  NFP: { fredId: "PAYEMS", units: "chg", name: "Nonfarm Payrolls (monthly change)", category: "EMPLOYMENT", unit: "K", frequency: "MONTHLY" },
  GDP_QOQ: { fredId: "A191RL1Q225SBEA", name: "US Real GDP (annualized QoQ)", category: "GDP", unit: "%", frequency: "QUARTERLY" },
  RETAIL: { fredId: "RSAFS", units: "pch", name: "Retail Sales (MoM)", category: "CONSUMER", unit: "%", frequency: "MONTHLY" },
  UOM_SENT: { fredId: "UMCSENT", name: "U. Michigan Consumer Sentiment", category: "CONSUMER", unit: "idx", frequency: "MONTHLY" },
};

// ─── Release calendar ───────────────────────────────────────────────────────

interface ReleaseSpec {
  releaseId: number;
  name: string;
  importance: 1 | 2 | 3;
  unit: string;
  timeUtc: string; // approximate publication time
  prev: { fredId: string; units?: SeriesSpec["units"]; scale?: number };
}

const RELEASES: ReleaseSpec[] = [
  { releaseId: 10, name: "CPI Inflation (YoY)", importance: 3, unit: "%", timeUtc: "T12:30:00Z", prev: { fredId: "CPIAUCSL", units: "pc1" } },
  { releaseId: 50, name: "Nonfarm Payrolls", importance: 3, unit: "K", timeUtc: "T12:30:00Z", prev: { fredId: "PAYEMS", units: "chg" } },
  { releaseId: 53, name: "GDP (annualized QoQ)", importance: 3, unit: "%", timeUtc: "T12:30:00Z", prev: { fredId: "A191RL1Q225SBEA" } },
  { releaseId: 54, name: "Personal Income & Outlays (Core PCE)", importance: 3, unit: "%", timeUtc: "T12:30:00Z", prev: { fredId: "PCEPILFE", units: "pc1" } },
  { releaseId: 9, name: "Retail Sales (MoM)", importance: 2, unit: "%", timeUtc: "T12:30:00Z", prev: { fredId: "RSAFS", units: "pch" } },
  { releaseId: 46, name: "PPI Final Demand (YoY)", importance: 2, unit: "%", timeUtc: "T12:30:00Z", prev: { fredId: "PPIFIS", units: "pc1" } },
  { releaseId: 180, name: "Initial Jobless Claims", importance: 2, unit: "K", timeUtc: "T12:30:00Z", prev: { fredId: "ICSA", scale: 1 / 1000 } },
  { releaseId: 91, name: "U. Michigan Sentiment", importance: 1, unit: "idx", timeUtc: "T14:00:00Z", prev: { fredId: "UMCSENT" } },
];

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function fredGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const key = process.env.FRED_API_KEY ?? "";
  const qs = new URLSearchParams({ ...params, api_key: key, file_type: "json" });
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${qs}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ProviderError(`FRED network error: ${String(err)}`, "upstream");
  }
  if (res.status === 429) throw new ProviderError("FRED rate limit (429)", "rate_limit");
  if (res.status === 400 || res.status === 403) {
    throw new ProviderError(`FRED API key rejected (HTTP ${res.status})`, "config");
  }
  if (!res.ok) throw new ProviderError(`FRED HTTP ${res.status}`, "upstream");
  return (await res.json()) as Record<string, unknown>;
}

interface FredObservation {
  date?: string;
  value?: string;
}

async function fetchObservations(fredId: string, units: string | undefined, limit: number): Promise<{ date: string; value: number }[]> {
  const params: Record<string, string> = {
    series_id: fredId,
    sort_order: "desc",
    limit: String(limit),
  };
  if (units) params.units = units;
  const json = await fredGet("/series/observations", params);
  const obs = (json.observations as FredObservation[] | undefined) ?? [];
  return obs
    .map((o) => ({ date: o.date ?? "", value: Number(o.value) }))
    .filter((o) => o.date && Number.isFinite(o.value))
    .reverse(); // desc → ascending for charts
}

// ─── Public adapter ─────────────────────────────────────────────────────────

export const fred = {
  isConfigured(): boolean {
    return Boolean(process.env.FRED_API_KEY);
  },

  async getEconSeries(id: string): Promise<EconSeries | null> {
    const spec = SERIES_SPECS[id];
    if (!spec) return null;
    const limit = spec.frequency === "DAILY" ? 1300 : spec.frequency === "WEEKLY" ? 260 : 60;
    const points = await fetchObservations(spec.fredId, spec.units, limit);
    if (points.length === 0) throw new ProviderError(`FRED: no observations for ${spec.fredId}`, "not_found");
    return {
      provider: "fred",
      status: "DELAYED",
      asOf: new Date().toISOString(),
      id,
      name: spec.name,
      category: spec.category,
      unit: spec.unit,
      frequency: spec.frequency,
      points,
    };
  },

  async listEconSeries(): Promise<{ id: string; name: string; category: string; latest: number; unit: string; provider: string; status: "DELAYED" }[]> {
    const out = [];
    for (const [id, spec] of Object.entries(SERIES_SPECS)) {
      try {
        const points = await fetchObservations(spec.fredId, spec.units, 1);
        if (points.length === 0) continue;
        out.push({
          id, name: spec.name, category: spec.category,
          latest: points[points.length - 1]!.value, unit: spec.unit,
          provider: "fred", status: "DELAYED" as const,
        });
      } catch {
        // A series FRED can't serve right now is omitted, not faked.
      }
    }
    return out;
  },

  async getEconCalendar(): Promise<EconEvent[]> {
    const events: EconEvent[] = [];
    const now = Date.now();
    const windowPast = now - 14 * 86_400_000;
    const windowFuture = now + 75 * 86_400_000;
    for (const rel of RELEASES) {
      try {
        const [datesJson, prevPoints] = await Promise.all([
          fredGet("/release/dates", {
            release_id: String(rel.releaseId),
            include_release_dates_with_no_data: "true",
            sort_order: "desc",
            limit: "8",
          }),
          fetchObservations(rel.prev.fredId, rel.prev.units, 1).catch(() => []),
        ]);
        const previous = prevPoints.length > 0
          ? Math.round(prevPoints[prevPoints.length - 1]!.value * (rel.prev.scale ?? 1) * 100) / 100
          : null;
        const dates = ((datesJson.release_dates as { date?: string }[] | undefined) ?? [])
          .map((d) => d.date ?? "")
          .filter(Boolean)
          .map((date) => new Date(`${date}${rel.timeUtc}`).getTime())
          .filter((t) => t >= windowPast && t <= windowFuture)
          .sort((a, b) => a - b);
        // Keep the most recent past release plus the next two scheduled ones.
        const past = dates.filter((t) => t <= now).slice(-1);
        const future = dates.filter((t) => t > now).slice(0, 2);
        for (const t of [...past, ...future]) {
          events.push({
            id: `fred-${rel.releaseId}-${new Date(t).toISOString().slice(0, 10)}`,
            datetime: new Date(t).toISOString(),
            country: "US",
            name: rel.name,
            importance: rel.importance,
            previous,
            forecast: null, // FRED publishes no consensus estimates
            actual: null,
            unit: rel.unit,
            provider: "fred",
            status: "DELAYED",
          });
        }
      } catch {
        // A release that fails is omitted, not faked.
      }
    }
    if (events.length === 0) throw new ProviderError("FRED: no release dates available", "upstream");
    return events.sort((a, b) => a.datetime.localeCompare(b.datetime));
  },
};
