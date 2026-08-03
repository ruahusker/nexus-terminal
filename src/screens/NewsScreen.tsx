"use client";

// NEWS — live RSS feed (provider mode) or sample feed (demo mode), with search, topic/symbol filters,
// duplicate grouping, saved articles, and a 60s auto-refresh.

import { useEffect, useMemo, useState } from "react";
import { useTerminal } from "@/components/TerminalContext";
import { EmptyState, ErrorState, Loading, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtRelative } from "@/lib/format";
import type { NewsItem } from "@/lib/types";

const TOPICS = ["Earnings", "M&A", "Macro", "Central Banks", "Technology", "Energy", "Regulation", "Crypto"];

interface SavedArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  symbol: string | null;
  savedAt: string;
}

/** Dedup key: first ~6 words of the headline, case/punctuation normalized. */
function groupKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

function SampleTag() {
  return (
    <span className="shrink-0 border border-nx-purple/40 px-1 text-[8px] uppercase tracking-wider text-nx-purple">
      Sample
    </span>
  );
}

function StoryRow({
  item,
  saved,
  onToggleSave,
  onOpenSym,
}: {
  item: NewsItem;
  saved: boolean;
  onToggleSave: () => void;
  onOpenSym: (s: string) => void;
}) {
  return (
    <li className="border-b border-nx-border">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Read: ${item.headline}`}
        className="block cursor-pointer px-2 py-1 hover:bg-nx-panel-2"
      >
        <div className="flex items-baseline gap-2 text-[10px] text-nx-faint">
          <span className="shrink-0 tabular-nums">{fmtRelative(item.publishedAt)}</span>
          <span className="shrink-0 text-nx-muted">{item.source}</span>
          {item.sample && <SampleTag />}
          <span className="min-w-0 flex-1 truncate text-[11px] text-nx-text-bright [font-family:var(--font-sans)]">
            {item.headline}
          </span>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSave();
            }}
            aria-label={saved ? `Unsave: ${item.headline}` : `Save: ${item.headline}`}
            aria-pressed={saved}
            className={`shrink-0 border px-1.5 py-px text-[9px] ${
              saved
                ? "border-nx-amber/50 text-nx-amber"
                : "border-nx-border text-nx-faint hover:border-nx-border-strong hover:text-nx-text"
            }`}
          >
            {saved ? "★ Saved" : "☆ Save"}
          </button>
        </div>
        {item.symbols.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {item.symbols.map((s) => (
              <button
                key={s}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenSym(s);
                }}
                aria-label={`Open ${s}`}
                className="border border-nx-border px-1 text-[9px] font-semibold text-nx-cyan hover:border-cyan-500/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </a>
    </li>
  );
}

export default function NewsScreen({ symbol }: { symbol?: string }) {
  const { open } = useTerminal();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [sym, setSym] = useState((symbol ?? "").toUpperCase());
  const [showSaved, setShowSaved] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [mutating, setMutating] = useState(false);

  // Debounce free-text search → q= param
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const feedPath = `/api/news?symbol=${encodeURIComponent(sym.trim().toUpperCase())}&topic=${encodeURIComponent(topic)}&q=${encodeURIComponent(q)}&limit=40`;
  const feed = useApi<NewsItem[]>(showSaved ? null : feedPath, 60_000);
  const hasSample = (feed.data ?? []).some((i) => i.sample);
  const savedApi = useApi<SavedArticle[]>("/api/saved?kind=articles");

  const savedIds = useMemo(() => new Set((savedApi.data ?? []).map((a) => a.id)), [savedApi.data]);

  // Group near-duplicate stories by normalized first-6-words of the headline
  const groups = useMemo(() => {
    const map = new Map<string, NewsItem[]>();
    for (const item of feed.data ?? []) {
      const key = groupKey(item.headline) || item.id;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [feed.data]);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const toggleSave = async (item: NewsItem) => {
    setMutating(true);
    try {
      if (savedIds.has(item.id)) {
        await api("/api/saved", { method: "POST", body: JSON.stringify({ kind: "deleteArticle", id: item.id }) });
      } else {
        await api("/api/saved", {
          method: "POST",
          body: JSON.stringify({
            kind: "article",
            id: item.id,
            title: item.headline,
            source: item.source,
            url: item.url,
            symbol: item.symbols[0],
          }),
        });
      }
      savedApi.retry();
    } finally {
      setMutating(false);
    }
  };

  const openSym = (s: string) => open("security", s);

  const renderStory = (item: NewsItem) => (
    <StoryRow
      key={item.id}
      item={item}
      saved={savedIds.has(item.id)}
      onToggleSave={() => void toggleSave(item)}
      onOpenSym={openSym}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="News">
      {hasSample && <SampleBanner />}
      {hasSample && (
        <div className="border-b border-nx-purple/30 bg-nx-purple/5 px-2 py-0.5 text-[9px] text-nx-purple" role="note">
          Stories tagged SAMPLE are generated demo text — not real news. Untagged stories are real RSS headlines.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-nx-border px-2 py-1">
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search headlines…"
          aria-label="Search headlines"
          className="w-40 bg-nx-inset px-2 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
        />
        <select
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-label="Filter by topic"
          className="bg-nx-inset px-1 py-0.5 text-[11px] text-nx-text focus:outline-none"
        >
          <option value="">All topics</option>
          {TOPICS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          value={sym}
          onChange={(e) => setSym(e.target.value.toUpperCase())}
          placeholder="Symbol"
          aria-label="Filter by symbol"
          className="w-20 bg-nx-inset px-2 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
        />
        <button
          onClick={() => setShowSaved((v) => !v)}
          aria-pressed={showSaved}
          className={`border px-2 py-0.5 text-[10px] ${
            showSaved
              ? "border-nx-amber/50 text-nx-amber"
              : "border-nx-border text-nx-muted hover:text-nx-text"
          }`}
        >
          {showSaved ? "★ Saved" : "☆ Saved"}
        </button>
        <span className="ml-auto text-[9px] text-nx-faint">
          {showSaved ? `${savedApi.data?.length ?? 0} saved` : "Auto-refresh 60s"}
          {mutating ? " · saving…" : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {showSaved ? (
          savedApi.loading && !savedApi.data ? (
            <Loading label="Loading saved articles" />
          ) : savedApi.error && !savedApi.data ? (
            <ErrorState message={savedApi.error} onRetry={savedApi.retry} />
          ) : (savedApi.data ?? []).length === 0 ? (
            <EmptyState message="No saved articles" hint="Use the Save button on any story in the feed" />
          ) : (
            <ul aria-label="Saved articles">
              {(savedApi.data ?? []).map((a) => (
                <li key={a.id} className="border-b border-nx-border px-2 py-1">
                  <div className="flex items-baseline gap-2 text-[10px] text-nx-faint">
                    <span className="shrink-0 tabular-nums">{fmtRelative(a.savedAt)}</span>
                    <span className="shrink-0 text-nx-muted">{a.source}</span>
                    {["Nexus Wire", "Market Desk", "Capital Report", "The Ledger", "Global Markets Daily"].includes(a.source) && <SampleTag />}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-nx-text-bright [font-family:var(--font-sans)]">
                      {a.title}
                    </span>
                    <button
                      onClick={() => {
                        setMutating(true);
                        void api("/api/saved", { method: "POST", body: JSON.stringify({ kind: "deleteArticle", id: a.id }) })
                          .then(() => savedApi.retry())
                          .finally(() => setMutating(false));
                      }}
                      aria-label={`Delete saved article: ${a.title}`}
                      className="shrink-0 text-nx-faint hover:text-nx-down"
                    >
                      ✕
                    </button>
                  </div>
                  {a.symbol && (
                    <div className="mt-0.5">
                      <button
                        onClick={() => openSym(a.symbol as string)}
                        aria-label={`Open ${a.symbol}`}
                        className="border border-nx-border px-1 text-[9px] font-semibold text-nx-cyan hover:border-nx-cyan/50"
                      >
                        {a.symbol}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : feed.loading && !feed.data ? (
          <Loading label="Loading news" />
        ) : feed.error && !feed.data ? (
          <ErrorState message={feed.error} onRetry={feed.retry} />
        ) : groups.length === 0 ? (
          <EmptyState message="No stories match" hint="Clear the search, topic, or symbol filter" />
        ) : (
          <>
            <SectionTitle>{topic || "Top Stories"}</SectionTitle>
            <ul aria-label="News feed">
              {groups.map((g) =>
                g.items.length === 1 ? (
                  renderStory(g.items[0] as NewsItem)
                ) : (
                  <li key={g.key} className="border-b border-nx-border">
                    <ul>
                      {renderStory(g.items[0] as NewsItem)}
                      {openGroups.has(g.key) && g.items.slice(1).map((item) => renderStory(item))}
                    </ul>
                    <button
                      onClick={() => setOpenGroups((s) => toggle(s, g.key))}
                      aria-expanded={openGroups.has(g.key)}
                      className="w-full px-2 py-0.5 text-left text-[9px] text-nx-faint hover:bg-nx-panel-2 hover:text-nx-cyan"
                    >
                      {openGroups.has(g.key) ? "▾ Hide" : "▸"} {g.items.length - 1} similar
                    </button>
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </div>
      <div className="border-t border-nx-border px-2 py-0.5 text-[9px] text-nx-faint">
        {hasSample ? "SAMPLE-tagged stories are generated demo text" : "Real headlines via RSS (CNBC Markets / MarketWatch / Investing.com)"} · Feed refreshes every 60s
      </div>
    </div>
  );
}
