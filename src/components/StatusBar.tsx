"use client";

// Bottom status bar: data mode, market status, clock, toast notifications.

import { useEffect, useState } from "react";
import { useTerminal } from "./TerminalContext";
import { useApi } from "./ui";
import { apiPath } from "@/lib/basePath";
import { fmtRelative } from "@/lib/format";
import type { MarketOverview, NewsItem } from "@/lib/types";

/** Rotating latest-headline strip above the status bar; click opens NEWS.
 *  Rotates every 10s and pauses while hovered so it stays readable. */
function NewsCrawl() {
  const { open } = useTerminal();
  const { data } = useApi<NewsItem[]>("/api/news?limit=12", 300_000);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx((i) => i + 1), 10_000);
    return () => clearInterval(t);
  }, [paused]);
  if (!data || data.length === 0) return null;
  const item = data[idx % data.length];
  if (!item) return null;
  return (
    <button
      onClick={() => open("news")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      title={item.headline}
      aria-label={`Latest headline: ${item.headline} — open news`}
      className="flex h-12 w-full items-center gap-3 overflow-hidden border-t-2 border-nx-amber/60 bg-nx-amber/10 px-3 text-left text-[20px]"
    >
      <span className="shrink-0 border border-nx-amber/60 bg-nx-amber/20 px-1.5 text-[14px] font-bold tracking-wider text-nx-amber">NEWS</span>
      <span className="shrink-0 text-[13px] tabular-nums text-nx-faint">{fmtRelative(item.publishedAt)}</span>
      <span className="shrink-0 text-[13px] text-nx-muted">{item.source}</span>
      <span className="truncate font-semibold text-nx-text-bright [font-family:var(--font-sans)]">{item.headline}</span>
      <span className="ml-auto shrink-0 text-[12px] text-nx-faint">{idx % data.length + 1}/{data.length}</span>
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="tabular-nums text-nx-muted" suppressHydrationWarning>
      {now ? now.toLocaleTimeString("en-US", { hour12: false }) : "--:--:--"} local
    </span>
  );
}

export function StatusBar({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const { toasts, dismissToast } = useTerminal();
  const { data } = useApi<MarketOverview>("/api/markets", 30_000);
  const { data: me } = useApi<{ user: { username: string } | null }>("/api/auth/me");
  const us = data?.marketStatus.us ?? "—";
  const statusColor = us === "REGULAR" ? "text-nx-up" : us === "PRE" || us === "POST" ? "text-nx-warn" : "text-nx-muted";

  const logout = async () => {
    try {
      await fetch(apiPath("/api/auth/logout"), { method: "POST" });
    } finally {
      window.location.href = apiPath("/login");
    }
  };

  return (
    <>
      {/* Toast stack */}
      <div className="pointer-events-none fixed bottom-8 right-2 z-50 flex w-80 flex-col gap-1" role="status" aria-live="polite">
        {toasts.slice(-4).map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start justify-between gap-2 border border-nx-amber/50 bg-nx-panel px-2 py-1.5 text-[11px] text-nx-text shadow-lg shadow-black/60">
            <span>
              <span className="mr-1 text-nx-amber">◆ ALERT</span>
              {t.message}
            </span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss alert" className="text-nx-muted hover:text-nx-text">✕</button>
          </div>
        ))}
      </div>

      <NewsCrawl />
      <footer className="flex h-6 items-center gap-4 border-t border-nx-border-strong bg-nx-panel px-2 text-[11px]" aria-label="Status bar">
        <span className="font-bold tracking-wider text-nx-amber">NEXUS TERMINAL</span>
        {!data ? (
          <span className="text-nx-faint">CONNECTING…</span>
        ) : data.status === "SAMPLE" ? (
          <span className="text-nx-purple">DEMO · SAMPLE DATA</span>
        ) : (
          <span className="text-nx-up">LIVE · ROBINHOOD/COINBASE/YAHOO</span>
        )}
        <span className={statusColor}>US: {us}</span>
        <span className="text-nx-up">CRYPTO: 24/7</span>
        {data && (
          <span className="hidden text-nx-muted md:inline">
            VIX {data.volatility[0]?.value.toFixed(2)} · 10Y {data.treasuries.find((t) => t.tenor === "10Y")?.yield.toFixed(2)}%
          </span>
        )}
        <span className="ml-auto" />
        <span className="flex items-center gap-0.5" role="group" aria-label="Interface zoom">
          <button
            onClick={() => onZoom(zoom - 0.1)}
            aria-label="Decrease text size"
            title="Decrease text size"
            className="px-1.5 text-nx-muted hover:text-nx-amber"
          >
            A−
          </button>
          <span className="w-9 text-center tabular-nums text-nx-faint" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => onZoom(zoom + 0.1)}
            aria-label="Increase text size"
            title="Increase text size"
            className="px-1.5 text-nx-muted hover:text-nx-amber"
          >
            A+
          </button>
        </span>
        <span className="hidden text-nx-faint lg:inline">` commands · Ctrl+1-6 panels · HELP for keys</span>
        <Clock />
        {me?.user && (
          <span className="flex items-center gap-1 border-l border-nx-border pl-2">
            <span className="text-nx-cyan">{me.user.username}</span>
            <button
              onClick={() => void logout()}
              aria-label="Sign out"
              className="px-1 text-nx-muted hover:text-nx-amber"
              title="Sign out"
            >
              ⏻
            </button>
          </span>
        )}
      </footer>
    </>
  );
}
