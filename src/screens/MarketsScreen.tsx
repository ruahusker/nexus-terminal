"use client";

// MARKETS — global market overview. Dense, quote-driven, live-streaming:
// the 15s poll refreshes structure (breadth, treasuries, sectors, rankings)
// while a 2s SSE quote stream keeps every price row ticking.

import { useEffect, useMemo, useState } from "react";
import { useTerminal } from "@/components/TerminalContext";
import { ErrorState, Loading, ProvenanceBadge, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { apiPath } from "@/lib/basePath";
import { dirClass, dirGlyph, fmtBps, fmtPct, fmtPrice, fmtRelative } from "@/lib/format";
import type { MarketOverview, Quote } from "@/lib/types";

function QuoteRow({ q, onOpen }: { q: Quote; onOpen: (s: string) => void }) {
  return (
    <tr
      tabIndex={0}
      onClick={() => onOpen(q.symbol)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(q.symbol)}
      className="cursor-pointer"
      aria-label={`${q.symbol} ${fmtPrice(q.price)} ${fmtPct(q.changePct)}`}
    >
      <td className="font-semibold text-nx-cyan">{q.symbol}</td>
      <td className="text-nx-text">{q.name ?? ""}</td>
      <td className="tabular-nums text-nx-text-bright">{fmtPrice(q.price, "")}</td>
      <td className={`tabular-nums ${dirClass(q.changePct)}`}>
        {dirGlyph(q.changePct)} {fmtPct(q.changePct)}
      </td>
    </tr>
  );
}

function QuoteBlock({ title, quotes, onOpen }: { title: string; quotes: Quote[]; onOpen: (s: string) => void }) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      <table className="nx-table">
        <tbody>
          {quotes.map((q) => (
            <QuoteRow key={q.symbol} q={q} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function MarketsScreen() {
  const { data, error, loading, retry } = useApi<MarketOverview>("/api/markets", 15_000);
  const { open } = useTerminal();
  const openSym = (s: string) => open("security", s);
  const [live, setLive] = useState<Map<string, Quote>>(new Map());

  // Every quoted symbol on the page, crypto first (24/7), capped at the
  // stream's 30-symbol limit.
  const symbols = useMemo(() => {
    if (!data) return [];
    const all = [
      ...data.crypto, ...data.indexes, ...data.mostActive, ...data.gainers,
      ...data.losers, ...data.commodities, ...data.fx,
    ].map((q) => q.symbol);
    return [...new Set(all)].slice(0, 30);
  }, [data]);
  const symKey = symbols.join(",");

  // 2s SSE quote stream, re-subscribing only when the symbol set changes.
  useEffect(() => {
    if (!symKey) return;
    const es = new EventSource(apiPath(`/api/stream?symbols=${encodeURIComponent(symKey)}`));
    es.onmessage = (ev) => {
      try {
        const qs = JSON.parse(ev.data as string) as Quote[];
        setLive((prev) => {
          const next = new Map(prev);
          for (const q of qs) next.set(q.symbol, q);
          return next;
        });
      } catch { /* malformed tick */ }
    };
    return () => es.close();
  }, [symKey]);

  if (loading && !data) return <Loading label="Loading markets" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;
  if (!data) return null;

  // Overlay the streamed tick's price fields onto each polled row (the
  // stream omits reference fields like name that the poll provides).
  const merge = (qs: Quote[]): Quote[] =>
    qs.map((q) => {
      const s = live.get(q.symbol);
      return s ? { ...q, price: s.price, change: s.change, changePct: s.changePct, bid: s.bid, ask: s.ask, asOf: s.asOf, provider: s.provider, status: s.status } : q;
    });

  const breadth = data.breadth;
  const total = breadth.advancing + breadth.declining + breadth.unchanged;
  const advPct = (breadth.advancing / total) * 100;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Market overview">
      {data.status === "SAMPLE" && <SampleBanner />}
      <div className="flex items-center justify-between border-b border-nx-border px-2 py-0.5 text-[10px] text-nx-muted">
        <ProvenanceBadge prov={data} />
        <span>Updated {fmtRelative(data.asOf)}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-nx-border md:grid-cols-2 xl:grid-cols-3">
        <div className="bg-nx-panel">
          <QuoteBlock title="Global Indexes" quotes={merge(data.indexes)} onOpen={openSym} />
          <section aria-label="Treasury yields">
            <SectionTitle>Treasury Yields</SectionTitle>
            <table className="nx-table">
              <tbody>
                {data.treasuries.map((t) => (
                  <tr key={t.tenor}>
                    <td className="font-semibold text-nx-cyan">{t.tenor}</td>
                    <td />
                    <td className="tabular-nums text-nx-text-bright">{t.yield.toFixed(2)}%</td>
                    <td className={`tabular-nums ${dirClass(t.changeBps)}`}>{fmtBps(t.changeBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <QuoteBlock title="Foreign Exchange" quotes={merge(data.fx)} onOpen={openSym} />
        </div>

        <div className="bg-nx-panel">
          <QuoteBlock title="Cryptocurrency · 24/7" quotes={merge(data.crypto)} onOpen={openSym} />
          <QuoteBlock title="Commodities" quotes={merge(data.commodities)} onOpen={openSym} />
          <section aria-label="Sector performance">
            <SectionTitle>Sector Performance</SectionTitle>
            <div className="space-y-px p-1" role="list">
              {data.sectors.map((s) => {
                const w = Math.min(100, Math.abs(s.changePct) * 4000);
                return (
                  <div key={s.name} role="listitem" className="flex items-center gap-2 px-1 text-[10px]">
                    <span className="w-36 truncate text-nx-muted">{s.name}</span>
                    <div className="h-2.5 flex-1 bg-nx-inset" aria-hidden>
                      <div
                        className={`h-full ${s.changePct >= 0 ? "bg-nx-up/60" : "bg-nx-down/60"}`}
                        style={{ width: `${Math.max(2, w)}%`, marginLeft: s.changePct < 0 ? "auto" : 0 }}
                      />
                    </div>
                    <span className={`w-16 text-right tabular-nums ${dirClass(s.changePct)}`}>
                      {dirGlyph(s.changePct)} {fmtPct(s.changePct)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="bg-nx-panel md:col-span-2 xl:col-span-1">
          <section aria-label="Market breadth">
            <SectionTitle>Market Breadth</SectionTitle>
            <div className="p-2">
              <div className="flex h-3 overflow-hidden" role="img" aria-label={`Advancers ${breadth.advancing}, decliners ${breadth.declining}, unchanged ${breadth.unchanged}`}>
                <div className="bg-nx-up/70" style={{ width: `${advPct}%` }} />
                <div className="bg-nx-border-strong" style={{ width: `${(breadth.unchanged / total) * 100}%` }} />
                <div className="bg-nx-down/70" style={{ width: `${(breadth.declining / total) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums">
                <span className="text-nx-up">▲ {breadth.advancing} adv</span>
                <span className="text-nx-muted">{breadth.unchanged} unch</span>
                <span className="text-nx-down">▼ {breadth.declining} dec</span>
              </div>
              <dl className="nx-kv mt-2">
                <dt>New highs</dt><dd className="text-nx-up">{breadth.newHighs}</dd>
                <dt>New lows</dt><dd className="text-nx-down">{breadth.newLows}</dd>
                {data.volatility.map((v) => (
                  <FragmentKV key={v.symbol} label={v.symbol} value={`${v.value.toFixed(2)} (${fmtPct(v.changePct)})`} dir={v.changePct} />
                ))}
              </dl>
            </div>
          </section>
          <QuoteBlock title="Most Active" quotes={merge(data.mostActive).slice(0, 6)} onOpen={openSym} />
          <QuoteBlock title="Top Gainers" quotes={merge(data.gainers).slice(0, 5)} onOpen={openSym} />
          <QuoteBlock title="Top Losers" quotes={merge(data.losers).slice(0, 5)} onOpen={openSym} />
        </div>
      </div>
    </div>
  );
}

function FragmentKV({ label, value, dir }: { label: string; value: string; dir: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={dirClass(dir)}>{value}</dd>
    </>
  );
}
