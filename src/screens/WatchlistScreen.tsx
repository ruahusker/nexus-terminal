"use client";

// WATCHLIST — multiple lists, live quotes via SSE, add/remove symbols.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTerminal } from "@/components/TerminalContext";
import { EmptyState, ErrorState, Loading, SectionTitle, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { apiPath } from "@/lib/basePath";
import { dirClass, dirGlyph, fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import type { Quote } from "@/lib/types";

interface WatchlistItem {
  id: string;
  symbol: string;
}
interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
}

export default function WatchlistScreen() {
  const { data, error, loading, retry } = useApi<Watchlist[]>("/api/watchlists", 60_000);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addSym, setAddSym] = useState("");
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [mutating, setMutating] = useState(false);
  const { open } = useTerminal();

  const lists = data ?? [];
  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  const symbols = useMemo(() => (active?.items ?? []).map((i) => i.symbol), [active]);
  const symKey = symbols.join(",");

  // Live quotes via SSE, re-subscribing when the list changes
  useEffect(() => {
    if (!symKey) {
      setQuotes(new Map());
      return;
    }
    const es = new EventSource(apiPath(`/api/stream?symbols=${encodeURIComponent(symKey)}`));
    es.onmessage = (ev) => {
      try {
        const qs = JSON.parse(ev.data as string) as Quote[];
        setQuotes((prev) => {
          const next = new Map(prev);
          for (const q of qs) next.set(q.symbol, q);
          return next;
        });
      } catch { /* malformed tick */ }
    };
    return () => es.close();
  }, [symKey]);

  const mutate = useCallback(
    async (body: object) => {
      setMutating(true);
      try {
        await api("/api/watchlists", { method: "POST", body: JSON.stringify(body) });
        retry();
      } finally {
        setMutating(false);
      }
    },
    [retry],
  );

  const addSymbol = () => {
    const sym = addSym.trim().toUpperCase();
    if (!sym || !active) return;
    setAddSym("");
    void mutate({ action: "add", listId: active.id, symbol: sym });
  };

  if (loading && !data) return <Loading label="Loading watchlists" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Watchlists">
      <div className="flex items-center gap-1 border-b border-nx-border-strong bg-nx-panel-2 px-1 py-0.5" role="tablist" aria-label="Watchlist selector">
        {lists.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={active?.id === l.id}
            onClick={() => setActiveId(l.id)}
            className={`px-2 py-0.5 text-[11px] ${active?.id === l.id ? "bg-nx-panel text-nx-amber" : "text-nx-muted hover:text-nx-text"}`}
          >
            {l.name}
          </button>
        ))}
        <button
          onClick={() => {
            const name = window.prompt("New watchlist name:");
            if (name?.trim()) void mutate({ action: "createList", name: name.trim() });
          }}
          className="px-2 text-[11px] text-nx-cyan hover:text-nx-text"
          aria-label="Create watchlist"
        >
          + List
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-nx-border px-2 py-1">
        <input
          value={addSym}
          onChange={(e) => setAddSym(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          placeholder="Add symbol…"
          aria-label="Add symbol to watchlist"
          className="w-28 bg-nx-inset px-2 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
        />
        <button onClick={addSymbol} disabled={mutating} className="border border-nx-border px-2 py-0.5 text-[10px] text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40">
          Add
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!active || active.items.length === 0 ? (
          <EmptyState message="This watchlist is empty" hint="Type a symbol above and press Enter" />
        ) : (
          <table className="nx-table" aria-label={`Watchlist ${active.name}`}>
            <thead>
              <tr>
                <th>Symbol</th><th>Last</th><th>Chg%</th><th>Bid</th><th>Ask</th><th>Volume</th><th>State</th><th />
              </tr>
            </thead>
            <tbody>
              {active.items.map((item) => {
                const q = quotes.get(item.symbol);
                return (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => open("security", item.symbol)}
                    onKeyDown={(e) => e.key === "Enter" && open("security", item.symbol)}
                  >
                    <td className="font-semibold text-nx-cyan">{item.symbol}</td>
                    <td className="tabular-nums text-nx-text-bright">{q ? fmtPrice(q.price, "") : "…"}</td>
                    <td className={`tabular-nums ${dirClass(q?.changePct)}`}>
                      {q ? `${dirGlyph(q.changePct)} ${fmtPct(q.changePct)}` : "…"}
                    </td>
                    <td className="tabular-nums text-nx-muted">{q ? fmtPrice(q.bid, "") : "…"}</td>
                    <td className="tabular-nums text-nx-muted">{q ? fmtPrice(q.ask, "") : "…"}</td>
                    <td className="tabular-nums text-nx-muted">{q ? fmtCompact(q.volume) : "…"}</td>
                    <td className="text-[10px] text-nx-faint">{q?.marketState ?? ""}</td>
                    <td>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void mutate({ action: "remove", listId: active.id, symbol: item.symbol });
                        }}
                        aria-label={`Remove ${item.symbol}`}
                        className="text-nx-faint hover:text-nx-down"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-nx-border px-2 py-0.5 text-[9px] text-nx-faint">
        Quotes stream every 2s via SSE · {[...quotes.values()].some((q) => q.status === "SAMPLE") ? "SAMPLE DATA" : "live provider quotes"}
      </div>
    </div>
  );
}
