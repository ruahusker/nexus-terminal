"use client";

// Breaking-news banner: appears above the command bar only when the newest
// headline is fresh (< 15 min). Red for market-shock keywords, amber for
// ordinary freshness. Click opens NEWS; ✕ dismisses until a newer story lands.

import { useEffect, useState } from "react";
import { useTerminal } from "./TerminalContext";
import { useApi } from "./ui";
import { fmtRelative } from "@/lib/format";
import type { NewsItem } from "@/lib/types";

const FRESH_MS = 15 * 60_000;
const SHOCK = /\b(crash|plunge|plummet|tumbles?|halts?|suspends?|emergency|bankrupt|default|fomc|fed (cuts?|hikes?|raises?|holds?)|rate (cut|hike)|cpi|inflation|nonfarm|payrolls?|jobs report|declares war|missile|sanctions|impeach|downgrades?|circuit breaker)\b/i;

export function BreakingBanner() {
  const { open } = useTerminal();
  const { data } = useApi<NewsItem[]>("/api/news?limit=6", 120_000);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Re-evaluate freshness every minute so the banner retires itself.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const latest = data?.[0];
  if (!latest) return null;
  const age = Date.now() - new Date(latest.publishedAt).getTime();
  if (age > FRESH_MS || latest.id === dismissedId) return null;

  const shock = SHOCK.test(latest.headline);
  return (
    <div
      role="alert"
      className={`flex h-6 items-center gap-2 overflow-hidden border-b px-2 text-[11px] ${
        shock
          ? "border-nx-down/50 bg-nx-down/15 text-nx-down"
          : "border-nx-amber/40 bg-nx-amber/10 text-nx-amber"
      }`}
    >
      <span className={`shrink-0 animate-pulse font-bold tracking-wider ${shock ? "" : "text-nx-amber"}`}>
        ◆ {shock ? "BREAKING" : "JUST IN"}
      </span>
      <span className="shrink-0 tabular-nums text-nx-faint">{fmtRelative(latest.publishedAt)}</span>
      <span className="shrink-0 text-nx-muted">{latest.source}</span>
      <button
        onClick={() => open("news")}
        title={latest.headline}
        className="min-w-0 flex-1 truncate text-left text-nx-text-bright hover:text-nx-amber [font-family:var(--font-sans)]"
      >
        {latest.headline}
      </button>
      <button
        onClick={() => setDismissedId(latest.id)}
        aria-label="Dismiss breaking news banner"
        className="shrink-0 px-1 text-nx-muted hover:text-nx-text"
      >
        ✕
      </button>
    </div>
  );
}
