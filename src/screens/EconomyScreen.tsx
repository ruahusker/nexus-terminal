"use client";

// ECONOMY — econ calendar, indicator series browser, the UST yield curve,
// and the market-wide earnings calendar.

import { useMemo, useState } from "react";
import { EmptyState, ErrorState, Loading, ProvenanceBadge, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { dirClass, dirGlyph, fmtBps, fmtNum, fmtTime } from "@/lib/format";
import type { EarningsEvent, EconEvent, EconSeries, MarketOverview } from "@/lib/types";

type Tab = "calendar" | "indicators" | "curve" | "earnings";
type ImpFilter = "all" | "high" | "medplus";

const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "CALENDAR" },
  { id: "earnings", label: "EARNINGS" },
  { id: "indicators", label: "INDICATORS" },
  { id: "curve", label: "YIELD CURVE" },
];

const CATEGORIES = ["RATES", "INFLATION", "EMPLOYMENT", "GDP", "CONSUMER", "CENTRAL_BANK"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  RATES: "Rates",
  INFLATION: "Inflation",
  EMPLOYMENT: "Employment",
  GDP: "GDP",
  CONSUMER: "Consumer",
  CENTRAL_BANK: "Central Bank",
};

interface SeriesListItem {
  id: string;
  name: string;
  category: string;
  latest: number;
  unit: string;
  provider?: string;
  status?: string;
}

// ─── Calendar ───────────────────────────────────────────────────────────────

const IMP_LABEL: Record<number, string> = { 3: "High", 2: "Med", 1: "Low" };

function ImportanceCell({ level }: { level: number }) {
  const dots = Array.from({ length: 3 }, (_, i) => i < level);
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Importance ${IMP_LABEL[level] ?? level}`}>
      <span aria-hidden className="tracking-tight">
        {dots.map((on, i) => (
          <span key={i} className={on ? "text-nx-amber" : "text-nx-faint"}>●</span>
        ))}
      </span>
      <span className={level === 3 ? "text-nx-amber" : level === 2 ? "text-nx-text" : "text-nx-muted"}>
        {IMP_LABEL[level] ?? "—"}
      </span>
    </span>
  );
}

function ActualCell({ ev }: { ev: EconEvent }) {
  if (ev.actual == null) return <td className="tabular-nums text-nx-faint">—</td>;
  const cmp = ev.forecast != null ? ev.actual - ev.forecast : null;
  return (
    <td className={`tabular-nums ${cmp != null ? dirClass(cmp) : "text-nx-text-bright"}`}>
      {cmp != null && <span aria-hidden>{dirGlyph(cmp)} </span>}
      {fmtNum(ev.actual)}
      {ev.unit}
      {cmp != null && (
        <span className="sr-only">{cmp >= 0 ? " above forecast" : " below forecast"}</span>
      )}
    </td>
  );
}

function CalendarView() {
  const { data, error, loading, retry } = useApi<EconEvent[]>("/api/economy?view=calendar");
  const [filter, setFilter] = useState<ImpFilter>("all");

  const events = useMemo(() => {
    const all = (data ?? []).slice().sort((a, b) => a.datetime.localeCompare(b.datetime));
    if (filter === "high") return all.filter((e) => e.importance === 3);
    if (filter === "medplus") return all.filter((e) => e.importance >= 2);
    return all;
  }, [data, filter]);

  const groups = useMemo(() => {
    const out: { day: string; items: EconEvent[] }[] = [];
    for (const ev of events) {
      const day = new Date(ev.datetime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(ev);
      else out.push({ day, items: [ev] });
    }
    return out;
  }, [events]);

  if (loading && !data) return <Loading label="Loading calendar" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  const now = Date.now();

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Economic calendar">
      {events.some((e) => e.status === "SAMPLE") && <SampleBanner />}
      <div className="flex items-center gap-1 border-b border-nx-border px-2 py-1" role="group" aria-label="Importance filter">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-nx-muted">Importance</span>
        {([["all", "All"], ["high", "High only"], ["medplus", "Med+"]] as [ImpFilter, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`border px-2 py-0.5 text-[10px] ${filter === id ? "border-nx-amber/50 text-nx-amber" : "border-nx-border text-nx-muted hover:text-nx-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.length === 0 ? (
          <EmptyState message="No events match this filter" hint="Try a broader importance filter" />
        ) : (
          groups.map((g) => (
            <section key={g.day} aria-label={`Events on ${g.day}`}>
              <SectionTitle>{g.day}</SectionTitle>
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>Time</th><th>Ctry</th><th>Event</th><th>Importance</th><th>Previous</th><th>Forecast</th><th>Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((ev) => {
                    const past = new Date(ev.datetime).getTime() < now;
                    return (
                      <tr key={ev.id} className={past ? "opacity-45" : undefined} aria-label={`${ev.name} ${IMP_LABEL[ev.importance] ?? ""} importance`}>
                        <td className="tabular-nums text-nx-muted">{fmtTime(ev.datetime)}</td>
                        <td className="font-semibold text-nx-cyan">{ev.country}</td>
                        <td className="text-nx-text-bright">{ev.name}</td>
                        <td><ImportanceCell level={ev.importance} /></td>
                        <td className="tabular-nums text-nx-muted">{ev.previous != null ? `${fmtNum(ev.previous)}${ev.unit}` : "—"}</td>
                        <td className="tabular-nums text-nx-muted">{ev.forecast != null ? `${fmtNum(ev.forecast)}${ev.unit}` : "—"}</td>
                        <ActualCell ev={ev} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Indicator series chart ─────────────────────────────────────────────────

function SeriesChart({ series }: { series: EconSeries }) {
  const W = 640;
  const H = 220;
  const PAD = { l: 46, r: 12, t: 14, b: 22 };
  const pts = series.points;
  if (pts.length < 2) return <EmptyState message="Not enough data points to chart" />;

  const values = pts.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.02 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * ih;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const lastIdx = pts.length - 1;
  const last = pts[lastIdx]!;
  const first = pts[0]!;
  const mid = pts[Math.floor(lastIdx / 2)]!;
  const yTicks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${series.name} history from ${first.date} to ${last.date}; latest value ${fmtNum(last.value)}${series.unit}`}
    >
      {/* gridlines + y-axis labels */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-nx-border)" strokeWidth="0.5" />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-nx-muted)" className="tabular-nums">
            {fmtNum(v)}
          </text>
        </g>
      ))}
      {/* x-axis labels */}
      <text x={PAD.l} y={H - 6} textAnchor="start" fontSize="9" fill="var(--color-nx-muted)">{first.date}</text>
      <text x={x(Math.floor(lastIdx / 2))} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--color-nx-muted)">{mid.date}</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="9" fill="var(--color-nx-muted)">{last.date}</text>
      {/* series line */}
      <path d={path} fill="none" stroke="var(--color-nx-cyan)" strokeWidth="1.2" />
      {/* latest point */}
      <circle cx={x(lastIdx)} cy={y(last.value)} r="2.5" fill="var(--color-nx-amber)" />
      <text x={x(lastIdx) - 5} y={y(last.value) - 6} textAnchor="end" fontSize="9" fontWeight="600" fill="var(--color-nx-amber)" className="tabular-nums">
        {fmtNum(last.value)}{series.unit}
      </text>
    </svg>
  );
}

function SeriesDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, loading, retry } = useApi<EconSeries>(`/api/economy?view=series&id=${encodeURIComponent(id)}`);

  if (loading && !data) return <Loading label={`Loading ${id}`} />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return null;

  const last = data.points[data.points.length - 1];

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label={`Series ${data.name}`}>
      {data.status === "SAMPLE" && <SampleBanner />}
      <div className="flex items-center gap-2 border-b border-nx-border-strong bg-nx-panel-2 px-2 py-1">
        <button
          onClick={onBack}
          aria-label="Back to indicator list"
          className="border border-nx-border px-2 py-0.5 text-[10px] text-nx-cyan hover:bg-nx-panel"
        >
          ← Back
        </button>
        <span className="text-[11px] font-semibold text-nx-text-bright">{data.name}</span>
        <span className="text-[10px] text-nx-muted">{data.id} · {data.frequency}</span>
        <span className="ml-auto"><ProvenanceBadge prov={data} /></span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <dl className="nx-kv mb-2">
          <dt>Latest</dt>
          <dd className="text-nx-text-bright">{last ? `${fmtNum(last.value)}${data.unit}` : "—"}</dd>
          <dt>As of</dt>
          <dd className="text-nx-muted">{last ? last.date : "—"}</dd>
          <dt>Category</dt>
          <dd className="text-nx-muted">{CATEGORY_LABEL[data.category] ?? data.category}</dd>
          <dt>Observations</dt>
          <dd className="text-nx-muted">{data.points.length}</dd>
        </dl>
        <SeriesChart series={data} />
      </div>
    </div>
  );
}

function IndicatorsView() {
  const { data, error, loading, retry } = useApi<SeriesListItem[]>("/api/economy?view=list");
  const [selected, setSelected] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byCat = new Map<string, SeriesListItem[]>();
    for (const s of data ?? []) {
      const arr = byCat.get(s.category);
      if (arr) arr.push(s);
      else byCat.set(s.category, [s]);
    }
    return CATEGORIES.filter((c) => byCat.has(c)).map((c) => ({ cat: c, items: byCat.get(c) ?? [] }));
  }, [data]);

  if (selected) return <SeriesDetail id={selected} onBack={() => setSelected(null)} />;
  if (loading && !data) return <Loading label="Loading indicators" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="No indicator series available" />;

  return (
    <div className="min-h-0 flex-1 overflow-auto" aria-label="Economic indicators">
      {data.some((s) => s.status === "SAMPLE") && <SampleBanner />}
      {grouped.map((g) => (
        <section key={g.cat} aria-label={CATEGORY_LABEL[g.cat] ?? g.cat}>
          <SectionTitle>{CATEGORY_LABEL[g.cat] ?? g.cat}</SectionTitle>
          <table className="nx-table">
            <tbody>
              {g.items.map((s) => (
                <tr
                  key={s.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => setSelected(s.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(s.id)}
                  aria-label={`${s.name} latest ${fmtNum(s.latest)}${s.unit} — open history`}
                >
                  <td className="w-24 font-semibold text-nx-cyan">{s.id}</td>
                  <td className="text-nx-text">{s.name}</td>
                  <td className="tabular-nums text-right text-nx-text-bright">{fmtNum(s.latest)}{s.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// ─── Yield curve ────────────────────────────────────────────────────────────

const TENOR_ORDER = ["3M", "2Y", "5Y", "10Y", "30Y"];

function YieldCurveView() {
  const { data, error, loading, retry } = useApi<MarketOverview>("/api/markets", 60_000);

  const rows = useMemo(() => {
    const ts = data?.treasuries ?? [];
    const sorted = ts
      .slice()
      .sort((a, b) => {
        const ia = TENOR_ORDER.indexOf(a.tenor);
        const ib = TENOR_ORDER.indexOf(b.tenor);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    return sorted;
  }, [data]);

  const inversions = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        if (a.yield > b.yield) out.push(`${a.tenor} (${a.yield.toFixed(2)}%) above ${b.tenor} (${b.yield.toFixed(2)}%)`);
      }
    }
    return out;
  }, [rows]);

  if (loading && !data) return <Loading label="Loading yield curve" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return null;
  if (rows.length === 0) return <EmptyState message="No treasury data available" />;

  const W = 640;
  const H = 240;
  const PAD = { l: 44, r: 16, t: 16, b: 26 };
  const yields = rows.map((r) => r.yield);
  const rawMin = Math.min(...yields);
  const rawMax = Math.max(...yields);
  const pad = (rawMax - rawMin) * 0.15 || 0.1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => (rows.length === 1 ? PAD.l + iw / 2 : PAD.l + (i / (rows.length - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * ih;
  const path = rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r.yield).toFixed(1)}`).join(" ");
  const yTicks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
  const inverted = inversions.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Treasury yield curve">
      <div className="flex items-center justify-between border-b border-nx-border px-2 py-0.5 text-[10px] text-nx-muted">
        <ProvenanceBadge prov={data} />
        <span className={inverted ? "text-nx-down" : "text-nx-up"} aria-label={inverted ? "Curve status: inverted" : "Curve status: normal"}>
          {inverted ? "▼ INVERTED" : "▲ NORMAL"} — {inverted ? inversions.join("; ") : "shorter tenors yield less than longer tenors"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Yield curve: ${rows.map((r) => `${r.tenor} ${r.yield.toFixed(2)}%`).join(", ")}. ${inverted ? "Curve is inverted." : "Curve is not inverted."}`}
        >
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-nx-border)" strokeWidth="0.5" />
              <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-nx-muted)" className="tabular-nums">
                {v.toFixed(2)}%
              </text>
            </g>
          ))}
          <path d={path} fill="none" stroke={inverted ? "var(--color-nx-down)" : "var(--color-nx-cyan)"} strokeWidth="1.4" />
          {rows.map((r, i) => (
            <g key={r.tenor}>
              <circle cx={x(i)} cy={y(r.yield)} r="2.5" fill="var(--color-nx-amber)" />
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-nx-cyan)">{r.tenor}</text>
              <text x={x(i)} y={y(r.yield) - 7} textAnchor="middle" fontSize="9" fill="var(--color-nx-text)" className="tabular-nums">
                {r.yield.toFixed(2)}%
              </text>
            </g>
          ))}
        </svg>

        <section aria-label="Treasury yields table" className="mt-2">
          <SectionTitle>Treasury Yields</SectionTitle>
          <table className="nx-table">
            <thead>
              <tr><th>Tenor</th><th>Yield</th><th>Change</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenor} aria-label={`${r.tenor} yield ${r.yield.toFixed(2)} percent, change ${fmtBps(r.changeBps)}`}>
                  <td className="font-semibold text-nx-cyan">{r.tenor}</td>
                  <td className="tabular-nums text-nx-text-bright">{r.yield.toFixed(2)}%</td>
                  <td className={`tabular-nums ${dirClass(r.changeBps)}`}>
                    {dirGlyph(r.changeBps)} {fmtBps(r.changeBps)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function EconomyScreen({ symbol: _symbol }: { symbol?: string }) {
  void _symbol;
  const [tab, setTab] = useState<Tab>("calendar");

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Economy">
      <div className="flex items-center gap-1 border-b border-nx-border-strong bg-nx-panel-2 px-1 py-0.5" role="tablist" aria-label="Economy views">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-2 py-0.5 text-[11px] ${tab === t.id ? "bg-nx-panel text-nx-amber" : "text-nx-muted hover:text-nx-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "calendar" && <CalendarView />}
        {tab === "earnings" && <EarningsView />}
        {tab === "indicators" && <IndicatorsView />}
        {tab === "curve" && <YieldCurveView />}
      </div>
    </div>
  );
}


/** EARNINGS — market-wide earnings calendar, grouped by date.
 *  Defaults to 3 days (the 7-day MCP pull takes ~45s on first load). */
function EarningsView() {
  const [days, setDays] = useState(3);
  const { data, error, loading, retry } = useApi<EarningsEvent[]>(`/api/earnings?days=${days}`, 300_000);

  const groups = useMemo(() => {
    const MAX_ROWS = 400;
    const out: { day: string; items: EarningsEvent[] }[] = [];
    let count = 0;
    for (const ev of (data ?? []).slice(0, MAX_ROWS)) {
      const day = new Date(ev.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(ev);
      else out.push({ day, items: [ev] });
      count++;
    }
    return { groups: out, capped: (data?.length ?? 0) > count ? (data?.length ?? 0) - count : 0 };
  }, [data]);

  if (loading && !data) return <Loading label="Loading earnings calendar" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  const hasSample = (data ?? []).some((e) => e.status === "SAMPLE");

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Earnings calendar">
      {hasSample && <SampleBanner />}
      <div className="flex items-center gap-1 border-b border-nx-border px-2 py-1" role="group" aria-label="Date range">
        <span className="mr-1 text-[10px] uppercase tracking-widest text-nx-muted">Range</span>
        {([3, 7, 14] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            aria-pressed={days === d}
            className={`border px-2 py-0.5 text-[10px] ${days === d ? "border-nx-amber/50 text-nx-amber" : "border-nx-border text-nx-muted hover:text-nx-text"}`}
          >
            {d}D
          </button>
        ))}
        {loading && data && <span className="ml-2 text-[9px] text-nx-faint">refreshing…</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.groups.length === 0 ? (
          <EmptyState message="No earnings scheduled this week" hint="Widen the window in a later build, or check DES <SYM> for a specific name" />
        ) : (
          <>
            {groups.groups.map((g) => (
            <section key={g.day} aria-label={`Earnings on ${g.day}`}>
              <SectionTitle>{g.day}</SectionTitle>
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>Symbol</th><th>Timing</th><th className="text-right">EPS Est</th><th className="text-right">EPS Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((ev, i) => (
                    <tr key={`${ev.symbol}-${i}`}>
                      <td>
                        <button
                          onClick={() => window.open(`https://finance.yahoo.com/quote/${encodeURIComponent(ev.symbol)}/earnings/`, "_blank", "noopener")}
                          aria-label={`Open ${ev.symbol} earnings on Yahoo Finance`}
                          title={`Open ${ev.symbol} earnings on Yahoo Finance`}
                          className="font-semibold text-nx-cyan hover:underline"
                        >
                          {ev.symbol} ↗
                        </button>
                      </td>
                      <td className="text-nx-muted">{ev.timing === "am" ? "Before open" : ev.timing === "pm" ? "After close" : ev.timing || "—"}</td>
                      <td className="tabular-nums text-right text-nx-text">{ev.epsEstimate != null ? fmtNum(ev.epsEstimate) : "—"}</td>
                      <td className="tabular-nums text-right text-nx-text-bright">{ev.epsActual != null ? fmtNum(ev.epsActual) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          {groups.capped > 0 && (
            <div className="px-2 py-1 text-[10px] text-nx-faint">+ {groups.capped} more this week — use DES &lt;SYM&gt; for a specific name</div>
          )}
          </>
        )}
      </div>
      <div className="border-t border-nx-border px-2 py-0.5 text-[9px] text-nx-faint">
        Next {days} days · Source: {data?.[0]?.provider ?? "—"} · Times are approximate (before open / after close) · 7D/14D first load can take ~1 min
      </div>
    </div>
  );
}
