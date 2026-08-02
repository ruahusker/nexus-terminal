"use client";

// Shared UI primitives for NEXUS panels.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Provenance } from "@/lib/types";
import { fmtTime } from "@/lib/format";
import { apiPath } from "@/lib/basePath";

export function ProvenanceBadge({ prov }: { prov: Pick<Provenance, "provider" | "status" | "asOf"> }) {
  const color =
    prov.status === "REALTIME" ? "text-nx-up border-nx-up/40"
    : prov.status === "DELAYED" ? "text-nx-warn border-nx-warn/40"
    : prov.status === "CACHED" ? "text-nx-cyan border-nx-cyan/40"
    : "text-nx-purple border-nx-purple/40";
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1 py-px text-[9px] uppercase tracking-wider ${color}`}
      title={`Source: ${prov.provider} · as of ${prov.asOf}`}
      aria-label={`Data status ${prov.status}, source ${prov.provider}`}
    >
      {prov.status === "SAMPLE" ? "SAMPLE DATA" : prov.status} · {prov.provider} · {fmtTime(prov.asOf)}
    </span>
  );
}

export function SampleBanner() {
  return (
    <div className="border-b border-nx-purple/30 bg-nx-purple/5 px-2 py-1 text-[10px] text-nx-purple" role="note">
      DEMO MODE — all market data below is deterministically generated sample data, not real market information.
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-nx-muted" role="status" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-spin border border-nx-border-strong border-t-nx-amber" aria-hidden />
      <span className="text-[11px]">{label}…</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center" role="alert">
      <div className="text-[11px] text-nx-down">⚠ {message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="border border-nx-border-strong px-3 py-1 text-[11px] text-nx-amber hover:bg-nx-panel-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <div className="text-[11px] text-nx-muted">{message}</div>
      {hint && <div className="text-[10px] text-nx-faint">{hint}</div>}
    </div>
  );
}

/** Simple SVG sparkline. */
export function Sparkline({ values, width = 80, height = 20, up }: { values: number[]; width?: number; height?: number; up?: boolean }) {
  if (values.length < 2) return <span className="text-nx-faint">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 2) - 1}`).join(" ");
  const stroke = up == null ? "var(--color-nx-cyan)" : up ? "var(--color-nx-up)" : "var(--color-nx-down)";
  return (
    <svg width={width} height={height} className="inline-block" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

/** Generic data-fetch hook with loading/error/retry and auto-refresh. */
export function useApi<T>(path: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(apiPath(path));
        const json = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
        if (cancelled || !mounted.current) return;
        if (!json.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        setData(json.data as T);
        setError(null);
      } catch (err) {
        if (!cancelled && mounted.current) setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [path, refreshMs, tick]);
  return { data, error, loading, retry: () => setTick((t) => t + 1) };
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-nx-border-strong bg-nx-panel-2 px-2 py-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-nx-amber">{children}</h3>
      {right}
    </div>
  );
}
