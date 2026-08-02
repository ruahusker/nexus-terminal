"use client";

// DES — security overview: quote header, stats, profile, financials, earnings, filings.

import { useState } from "react";
import { useTerminal } from "@/components/TerminalContext";
import {
  EmptyState, ErrorState, Loading, ProvenanceBadge, SampleBanner, SectionTitle, Sparkline, useApi,
} from "@/components/ui";
import { dirClass, dirGlyph, fmtCompact, fmtNum, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import type { Bar, Filing, FinancialPeriod, Fundamentals, InstrumentInfo, Quote } from "@/lib/types";

type TabId = "overview" | "financials" | "earnings" | "filings";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "financials", label: "FINANCIALS" },
  { id: "earnings", label: "EARNINGS" },
  { id: "filings", label: "FILINGS" },
];

function KV({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`tabular-nums ${cls ?? "text-nx-text"}`}>{value}</dd>
    </>
  );
}

/** 52-week range bar with a marker at the current price. */
function RangeBar({ low, high, price }: { low: number; high: number; price: number }) {
  const span = high - low;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((price - low) / span) * 100)) : 50;
  return (
    <div className="px-2 py-1" role="img" aria-label={`52-week range ${fmtPrice(low, "")} to ${fmtPrice(high, "")}, current ${fmtPrice(price, "")}`}>
      <div className="relative h-1.5 bg-nx-inset">
        <div className="absolute inset-y-0 left-0 bg-nx-cyan/40" style={{ width: `${pct}%` }} />
        <div className="absolute -top-0.5 h-2.5 w-px bg-nx-amber" style={{ left: `${pct}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-nx-muted">
        <span>{fmtPrice(low, "")}</span>
        <span className="text-nx-amber">{fmtPrice(price, "")}</span>
        <span>{fmtPrice(high, "")}</span>
      </div>
    </div>
  );
}

function FinTable({ title, periods }: { title: string; periods: FinancialPeriod[] }) {
  const labels: string[] = [];
  for (const p of periods) {
    for (const k of Object.keys(p.values)) if (!labels.includes(k)) labels.push(k);
  }
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      <table className="nx-table">
        <thead>
          <tr>
            <th>Line Item</th>
            {periods.map((p) => (
              <th key={p.period} className="text-right">{p.period}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label) => (
            <tr key={label}>
              <td className="text-nx-text">{label}</td>
              {periods.map((p) => {
                const v = p.values[label];
                return (
                  <td key={p.period} className={`tabular-nums text-right ${v != null && v < 0 ? "text-nx-down" : "text-nx-text-bright"}`}>
                    {v != null ? fmtCompact(v) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function SecurityScreen({ symbol }: { symbol?: string }) {
  const sym = symbol?.toUpperCase() ?? null;
  const [tab, setTab] = useState<TabId>("overview");
  const { open } = useTerminal();

  const quotes = useApi<Quote[]>(sym ? `/api/quote?symbols=${encodeURIComponent(sym)}` : null, 15_000);
  const fund = useApi<Fundamentals>(sym ? `/api/fundamentals?symbol=${encodeURIComponent(sym)}` : null);
  const inst = useApi<InstrumentInfo>(sym ? `/api/instrument?symbol=${encodeURIComponent(sym)}` : null);
  const barsResp = useApi<{ bars: Bar[] }>(sym ? `/api/bars?symbol=${encodeURIComponent(sym)}&interval=1d&range=3M` : null);
  const barsData = barsResp.data?.bars ?? null;
  const filings = useApi<Filing[]>(sym && tab === "filings" ? `/api/filings?symbol=${encodeURIComponent(sym)}` : null);

  if (!sym) return <EmptyState message="No security selected" hint="Type a symbol in the command bar, e.g. AAPL" />;
  if (quotes.loading && !quotes.data) return <Loading label={`Loading ${sym}`} />;
  if (quotes.error && !quotes.data) return <ErrorState message={quotes.error} onRetry={quotes.retry} />;

  const q = quotes.data?.[0];
  if (!q) return <EmptyState message={`No quote available for ${sym}`} hint="Check the symbol and try again" />;

  const f = fund.data;
  // Market cap derived from the live quote × shares outstanding (universe data).
  const marketCap = inst.data?.sharesOut && q.price > 0
    ? inst.data.sharesOut * q.price
    : inst.data?.marketCap ?? null;
  const divYield = inst.data?.dividendYield ?? null;
  const spread = q.ask - q.bid;
  const spreadBps = q.price > 0 ? (spread / q.price) * 10_000 : null;
  const closes = (barsData ?? []).map((b) => b.close);
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const trendUp = firstClose != null && lastClose != null ? lastClose >= firstClose : undefined;
  const desc = f?.profile.description;
  const name = desc ? (desc.split(". ")[0] ?? sym) : sym;
  const upside = f?.analystEstimates && q.price > 0 ? (f.analystEstimates.targetMean - q.price) / q.price : null;
  const today = new Date().toISOString().slice(0, 10);
  const nextEarnings = f?.earningsCalendar.find((e) => e.date >= today && e.epsActual == null) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label={`Security overview ${sym}`}>
{q.status === "SAMPLE" && <SampleBanner />}

      {/* Header */}
      <div className="border-b border-nx-border-strong px-2 py-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-bold text-nx-amber">{q.symbol}</span>
          <span className="max-w-72 truncate text-[11px] text-nx-muted" title={desc ?? undefined}>{name}</span>
          <span className="text-[16px] font-semibold tabular-nums text-nx-text-bright">{fmtPrice(q.price, "")}</span>
          <span className={`text-[11px] tabular-nums ${dirClass(q.changePct)}`}>
            {dirGlyph(q.changePct)} {fmtPrice(Math.abs(q.change), "")} ({fmtPct(q.changePct)})
          </span>
          <span className="border border-nx-border px-1 py-px text-[9px] uppercase tracking-wider text-nx-cyan">{q.marketState}</span>
          <span className="ml-auto flex items-center gap-2">
            <Sparkline values={closes} width={120} height={22} up={trendUp} />
            <ProvenanceBadge prov={q} />
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-nx-border-strong bg-nx-panel-2 px-1 py-0.5" role="tablist" aria-label="Security sections">
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

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "overview" && (
          <div className="grid grid-cols-1 gap-px bg-nx-border xl:grid-cols-2">
            <div className="bg-nx-panel">
              <section aria-label="Key statistics">
                <SectionTitle>Key Statistics</SectionTitle>
                <dl className="nx-kv p-2">
                  <KV label="Bid" value={fmtPrice(q.bid, "")} cls="text-nx-text-bright" />
                  <KV label="Ask" value={fmtPrice(q.ask, "")} cls="text-nx-text-bright" />
                  <KV label="Spread" value={`${fmtPrice(spread, "")} (${spreadBps != null ? `${spreadBps.toFixed(1)}bp` : "—"})`} />
                  <KV label="Open" value={fmtPrice(q.open, "")} />
                  <KV label="High" value={fmtPrice(q.high, "")} cls="text-nx-up" />
                  <KV label="Low" value={fmtPrice(q.low, "")} cls="text-nx-down" />
                  <KV label="Prev Close" value={fmtPrice(q.prevClose, "")} />
                  <KV label="Volume" value={fmtCompact(q.volume)} />
                  <KV label="Avg Volume" value={fmtCompact(q.avgVolume)} />
                  <KV label="Market Cap" value={marketCap != null ? fmtCompact(marketCap) : "—"} />
                  <KV label="Div Yield" value={divYield != null ? fmtPct(divYield) : "—"} />
                  <KV label="Market State" value={q.marketState} cls="text-nx-cyan" />
                </dl>
              </section>
              <section aria-label="52-week range">
                <SectionTitle>52-Week Range</SectionTitle>
                <RangeBar low={q.week52Low} high={q.week52High} price={q.price} />
              </section>
              {f?.analystEstimates && (
                <section aria-label="Analyst estimates">
                  <SectionTitle right={f && f.provider !== "demo" ? undefined : <span className="text-[9px] text-nx-faint">SAMPLE</span>}>Analyst Estimates</SectionTitle>
                  <dl className="nx-kv p-2">
                    <KV label="Consensus" value={f.analystEstimates.rating} cls="text-nx-amber" />
                    <KV label="Target Mean" value={fmtPrice(f.analystEstimates.targetMean, "")} cls="text-nx-text-bright" />
                    <KV label="Target High" value={fmtPrice(f.analystEstimates.targetHigh, "")} />
                    <KV label="Target Low" value={fmtPrice(f.analystEstimates.targetLow, "")} />
                    <KV label="Analysts" value={String(f.analystEstimates.count)} />
                    {upside != null && (
                      <KV label="Upside vs Last" value={`${dirGlyph(upside)} ${fmtPct(upside)}`} cls={dirClass(upside)} />
                    )}
                  </dl>
                </section>
              )}
            </div>

            <div className="bg-nx-panel">
              <section aria-label="Company profile">
                <SectionTitle right={f ? <ProvenanceBadge prov={f} /> : undefined}>Company Profile</SectionTitle>
                {fund.loading && !f ? (
                  <div className="p-2 text-[11px] text-nx-muted">Loading profile…</div>
                ) : fund.error && !f ? (
                  <div className="p-2 text-[11px] text-nx-down">⚠ {fund.error}</div>
                ) : f ? (
                  <div className="p-2">
                    <p className="text-[11px] leading-snug text-nx-text">{f.profile.description}</p>
                    <dl className="nx-kv mt-2">
                      <KV label="Sector" value={f.profile.sector} cls="text-nx-cyan" />
                      <KV label="Industry" value={f.profile.industry} />
                      <KV label="Employees" value={f.profile.employees > 0 ? fmtNum(f.profile.employees, 0) : "—"} />
                      <KV label="HQ" value={f.profile.headquarters} />
                      <KV label="Founded" value={f.profile.founded > 0 ? String(f.profile.founded) : "—"} />
                      <dt>Website</dt>
                      <dd>
                        {f.profile.website ? (
                          <a href={f.profile.website} target="_blank" rel="noreferrer" className="text-nx-cyan underline decoration-nx-border-strong hover:text-nx-text-bright">
                            {f.profile.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </dl>
                  </div>
                ) : null}
              </section>
              {f && f.related.length > 0 && (
                <section aria-label="Related securities">
                  <SectionTitle>Related Securities</SectionTitle>
                  <div className="flex flex-wrap gap-1 p-2">
                    {f.related.map((r) => (
                      <button
                        key={r}
                        onClick={() => open("security", r)}
                        onKeyDown={(e) => e.key === "Enter" && open("security", r)}
                        className="border border-nx-border px-2 py-0.5 text-[11px] font-semibold text-nx-cyan hover:bg-nx-panel-2 hover:text-nx-text-bright focus:outline-none focus:border-nx-amber"
                        aria-label={`Open ${r} security overview`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {tab === "financials" && (
          <div className="bg-nx-panel">
            {fund.loading && !f ? (
              <Loading label="Loading financials" />
            ) : fund.error && !f ? (
              <ErrorState message={fund.error} onRetry={fund.retry} />
            ) : f ? (
              <>
                {f.status === "SAMPLE" && (
                  <div className="border-b border-nx-border px-2 py-1 text-[10px] text-nx-purple">
                    Statement values are SAMPLE data — not real financials.
                  </div>
                )}
                <FinTable title="Income Statement" periods={f.incomeStatement} />
                <FinTable title="Balance Sheet" periods={f.balanceSheet} />
                <FinTable title="Cash Flow" periods={f.cashFlow} />
              </>
            ) : null}
          </div>
        )}

        {tab === "earnings" && (
          <div className="bg-nx-panel">
            {fund.loading && !f ? (
              <Loading label="Loading earnings" />
            ) : fund.error && !f ? (
              <ErrorState message={fund.error} onRetry={fund.retry} />
            ) : f ? (
              <section aria-label="Earnings calendar">
                <SectionTitle right={f.provider === "demo" ? <span className="text-[9px] text-nx-faint">SAMPLE estimates — not guarantees</span> : undefined}>
                  Earnings Calendar
                </SectionTitle>
                {f.earningsCalendar.length === 0 ? (
                  <EmptyState message="No earnings events on file" />
                ) : (
                  <table className="nx-table">
                    <thead>
                      <tr><th>Date</th><th className="text-right">EPS Est</th><th className="text-right">EPS Actual</th><th className="text-right">Surprise</th><th /></tr>
                    </thead>
                    <tbody>
                      {f.earningsCalendar.map((e) => {
                        const isNext = nextEarnings?.date === e.date;
                        return (
                          <tr key={e.date} className={isNext ? "bg-nx-panel-2" : undefined} aria-label={isNext ? `Next earnings ${e.date}` : undefined}>
                            <td className={`tabular-nums ${isNext ? "font-semibold text-nx-amber" : "text-nx-text"}`}>{e.date}</td>
                            <td className="tabular-nums text-right text-nx-text">{e.epsEstimate != null ? fmtNum(e.epsEstimate) : "—"}</td>
                            <td className="tabular-nums text-right text-nx-text-bright">{e.epsActual != null ? fmtNum(e.epsActual) : "—"}</td>
                            <td className={`tabular-nums text-right ${dirClass(e.surprise)}`}>
                              {e.surprise != null ? `${dirGlyph(e.surprise)} ${fmtPct(e.surprise, 1)}` : "—"}
                            </td>
                            <td className="text-[9px] text-nx-amber">{isNext ? "NEXT" : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            ) : null}
          </div>
        )}

        {tab === "filings" && (
          <div className="bg-nx-panel">
            {filings.loading && !filings.data ? (
              <Loading label="Loading filings" />
            ) : filings.error && !filings.data ? (
              <ErrorState message={filings.error} onRetry={filings.retry} />
            ) : filings.data ? (
              <section aria-label="SEC filings">
                <SectionTitle right={<span className="text-[9px] text-nx-purple">SAMPLE filings — demonstration data</span>}>
                  Filings
                </SectionTitle>
                {filings.data.length === 0 ? (
                  <EmptyState message="No filings on file" />
                ) : (
                  <table className="nx-table">
                    <thead>
                      <tr><th>Type</th><th>Title</th><th className="text-right">Filed</th><th className="text-right">Source</th></tr>
                    </thead>
                    <tbody>
                      {filings.data.map((fl) => (
                        <tr key={fl.id}>
                          <td className="font-semibold text-nx-amber">{fl.type}</td>
                          <td className="text-nx-text">{fl.title}</td>
                          <td className="tabular-nums text-right text-nx-muted" title={fl.filedAt}>{fmtRelative(fl.filedAt)}</td>
                          <td className="text-right">
                            <a href={fl.url} target="_blank" rel="noreferrer" className="text-nx-cyan underline decoration-nx-border-strong hover:text-nx-text-bright" aria-label={`Open filing ${fl.type} for ${fl.symbol}`}>
                              link
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-nx-border px-2 py-0.5 text-[9px] text-nx-faint">
        Quote refreshes every 15s · Fundamentals: {f?.provider ?? "—"} · Source: {q.provider}
      </div>
    </div>
  );
}
