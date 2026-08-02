"use client";

// SCREENER — full-universe row set filtered client-side, sortable virtualized
// table, up-to-4 symbol comparison, CSV export, and saved screen criteria.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTerminal } from "@/components/TerminalContext";
import { EmptyState, ErrorState, Loading, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { dirClass, dirGlyph, fmtCompact, fmtMarketCap, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import type { ScreenerRow } from "@/lib/types";

interface SavedScreen {
  id: string;
  name: string;
  criteria: string;
}

// ─── Filter state (all text inputs; criteria is this object as JSON) ────────
interface Filters {
  mcapMin: string; // $M
  mcapMax: string;
  priceMin: string;
  priceMax: string;
  avgVolMin: string; // shares
  sectors: string[];
  changePctMin: string; // %
  peMin: string;
  peMax: string;
  divYieldMin: string; // %
  revGrowthMin: string; // %
  grossMarginMin: string; // %
  roeMin: string; // %
  rsiMin: string;
  rsiMax: string;
  ivMin: string; // %
  optVolMin: string;
  optOiMin: string;
}

const EMPTY_FILTERS: Filters = {
  mcapMin: "", mcapMax: "", priceMin: "", priceMax: "", avgVolMin: "",
  sectors: [], changePctMin: "", peMin: "", peMax: "", divYieldMin: "",
  revGrowthMin: "", grossMarginMin: "", roeMin: "", rsiMin: "", rsiMax: "",
  ivMin: "", optVolMin: "", optOiMin: "",
};

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof Filters)[];

function sanitizeCriteria(raw: unknown): Filters {
  const f: Filters = { ...EMPTY_FILTERS, sectors: [] };
  if (!raw || typeof raw !== "object") return f;
  const o = raw as Record<string, unknown>;
  for (const key of FILTER_KEYS) {
    if (key === "sectors") continue;
    const v = o[key];
    if (typeof v === "string") f[key] = v;
  }
  if (Array.isArray(o.sectors)) f.sectors = o.sectors.filter((s): s is string => typeof s === "string");
  return f;
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

// ─── Columns ────────────────────────────────────────────────────────────────
interface Col {
  key: string;
  label: string;
  get: (r: ScreenerRow) => number | string | null;
  cell: (r: ScreenerRow) => ReactNode;
  csv: (r: ScreenerRow) => string;
}

const txt = (v: number | string | null) => (v == null ? "" : String(v));

const COLUMNS: Col[] = [
  {
    key: "symbol", label: "Symbol", get: (r) => r.symbol,
    cell: (r) => <span className="font-semibold text-nx-cyan">{r.symbol}</span>,
    csv: (r) => r.symbol,
  },
  {
    key: "name", label: "Name", get: (r) => r.name,
    cell: (r) => <span className="text-nx-muted">{r.name}</span>,
    csv: (r) => r.name,
  },
  {
    key: "sector", label: "Sector", get: (r) => r.sector ?? null,
    cell: (r) => <span className="text-nx-muted">{r.sector ?? "—"}</span>,
    csv: (r) => r.sector ?? "",
  },
  {
    key: "price", label: "Price", get: (r) => r.price,
    cell: (r) => <span className="tabular-nums text-nx-text-bright">{fmtPrice(r.price, "")}</span>,
    csv: (r) => txt(r.price),
  },
  {
    key: "changePct", label: "Chg%", get: (r) => r.changePct,
    cell: (r) => (
      <span className={`tabular-nums ${dirClass(r.changePct)}`}>
        {dirGlyph(r.changePct)} {fmtPct(r.changePct)}
      </span>
    ),
    csv: (r) => txt(r.changePct),
  },
  {
    key: "volume", label: "Volume", get: (r) => r.volume,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtCompact(r.volume)}</span>,
    csv: (r) => txt(r.volume),
  },
  {
    key: "avgVolume", label: "AvgVol", get: (r) => r.avgVolume,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtCompact(r.avgVolume)}</span>,
    csv: (r) => txt(r.avgVolume),
  },
  {
    key: "marketCap", label: "MktCap", get: (r) => r.marketCap ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtMarketCap(r.marketCap)}</span>,
    csv: (r) => txt(r.marketCap ?? null),
  },
  {
    key: "peRatio", label: "P/E", get: (r) => r.peRatio ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtNum(r.peRatio, 1)}</span>,
    csv: (r) => txt(r.peRatio ?? null),
  },
  {
    key: "dividendYield", label: "Yield", get: (r) => r.dividendYield ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{r.dividendYield == null ? "—" : fmtPct(r.dividendYield, 2, false)}</span>,
    csv: (r) => txt(r.dividendYield ?? null),
  },
  {
    key: "beta", label: "Beta", get: (r) => r.beta ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtNum(r.beta, 2)}</span>,
    csv: (r) => txt(r.beta ?? null),
  },
  {
    key: "rsi14", label: "RSI14", get: (r) => r.rsi14 ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtNum(r.rsi14, 1)}</span>,
    csv: (r) => txt(r.rsi14 ?? null),
  },
  {
    key: "iv30", label: "IV30", get: (r) => r.iv30 ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{r.iv30 == null ? "—" : fmtPct(r.iv30, 1, false)}</span>,
    csv: (r) => txt(r.iv30 ?? null),
  },
  {
    key: "optVolume", label: "OptVol", get: (r) => r.optVolume ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtCompact(r.optVolume)}</span>,
    csv: (r) => txt(r.optVolume ?? null),
  },
  {
    key: "optOpenInterest", label: "OptOI", get: (r) => r.optOpenInterest ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtCompact(r.optOpenInterest)}</span>,
    csv: (r) => txt(r.optOpenInterest ?? null),
  },
  {
    key: "week52High", label: "52W Hi", get: (r) => r.week52High,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtPrice(r.week52High, "")}</span>,
    csv: (r) => txt(r.week52High),
  },
  {
    key: "week52Low", label: "52W Lo", get: (r) => r.week52Low,
    cell: (r) => <span className="tabular-nums text-nx-muted">{fmtPrice(r.week52Low, "")}</span>,
    csv: (r) => txt(r.week52Low),
  },
  {
    key: "revenueGrowth", label: "RevGr", get: (r) => r.revenueGrowth ?? null,
    cell: (r) => <span className={`tabular-nums ${dirClass(r.revenueGrowth)}`}>{r.revenueGrowth == null ? "—" : `${dirGlyph(r.revenueGrowth)} ${fmtPct(r.revenueGrowth, 1)}`}</span>,
    csv: (r) => txt(r.revenueGrowth ?? null),
  },
  {
    key: "grossMargin", label: "GM", get: (r) => r.grossMargin ?? null,
    cell: (r) => <span className="tabular-nums text-nx-muted">{r.grossMargin == null ? "—" : fmtPct(r.grossMargin, 1, false)}</span>,
    csv: (r) => txt(r.grossMargin ?? null),
  },
  {
    key: "roe", label: "ROE", get: (r) => r.roe ?? null,
    cell: (r) => <span className={`tabular-nums ${dirClass(r.roe)}`}>{r.roe == null ? "—" : `${dirGlyph(r.roe)} ${fmtPct(r.roe, 1)}`}</span>,
    csv: (r) => txt(r.roe ?? null),
  },
];

const ROW_H = 21;
const OVERSCAN = 8;
const MAX_COMPARE = 4;

// ─── Filtering ──────────────────────────────────────────────────────────────
function matches(r: ScreenerRow, f: Filters): boolean {
  const ge = (v: number | null | undefined, min: number | null) => min == null || (v != null && v >= min);
  const le = (v: number | null | undefined, max: number | null) => max == null || (v != null && v <= max);
  if (!ge(r.marketCap, num(f.mcapMin) == null ? null : (num(f.mcapMin) as number) * 1e6)) return false;
  if (!le(r.marketCap, num(f.mcapMax) == null ? null : (num(f.mcapMax) as number) * 1e6)) return false;
  if (!ge(r.price, num(f.priceMin))) return false;
  if (!le(r.price, num(f.priceMax))) return false;
  if (!ge(r.avgVolume, num(f.avgVolMin))) return false;
  if (f.sectors.length > 0 && (!r.sector || !f.sectors.includes(r.sector))) return false;
  if (!ge(r.changePct * 100, num(f.changePctMin))) return false;
  if (!ge(r.peRatio, num(f.peMin))) return false;
  if (!le(r.peRatio, num(f.peMax))) return false;
  if (!ge(r.dividendYield == null ? null : r.dividendYield * 100, num(f.divYieldMin))) return false;
  if (!ge(r.revenueGrowth == null ? null : r.revenueGrowth * 100, num(f.revGrowthMin))) return false;
  if (!ge(r.grossMargin == null ? null : r.grossMargin * 100, num(f.grossMarginMin))) return false;
  if (!ge(r.roe == null ? null : r.roe * 100, num(f.roeMin))) return false;
  if (!ge(r.rsi14, num(f.rsiMin))) return false;
  if (!le(r.rsi14, num(f.rsiMax))) return false;
  if (!ge(r.iv30 == null ? null : r.iv30 * 100, num(f.ivMin))) return false;
  if (!ge(r.optVolume, num(f.optVolMin))) return false;
  if (!ge(r.optOpenInterest, num(f.optOiMin))) return false;
  return true;
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function FilterInput({ label, value, onChange, width = "w-16" }: { label: string; value: string; onChange: (v: string) => void; width?: string }) {
  return (
    <label className="flex items-center gap-1 text-[9px] text-nx-muted">
      <span className="whitespace-nowrap">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={label}
        className={`${width} bg-nx-inset px-1 py-px text-[10px] tabular-nums text-nx-text focus:outline-none`}
      />
    </label>
  );
}

export default function ScreenerScreen(_props: { symbol?: string }) {
  const { open } = useTerminal();
  const { data, error, loading, retry } = useApi<ScreenerRow[]>("/api/screener", 120_000);
  const savedApi = useApi<SavedScreen[]>("/api/saved?kind=screens");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [appliedId, setAppliedId] = useState("");
  const [mutating, setMutating] = useState(false);

  const rows = data ?? [];
  const sectors = useMemo(
    () => [...new Set(rows.map((r) => r.sector).filter((s): s is string => !!s))].sort(),
    [rows],
  );

  const set = (key: keyof Filters, value: string) => {
    setAppliedId("");
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const filtered = useMemo(() => rows.filter((r) => matches(r, filters)), [rows, filters]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // ─── Virtualization: fixed row height, window from scrollTop + overscan ───
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, [loading]);
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(sorted.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const visible = sorted.slice(startIdx, endIdx);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleSelect = (sym: string) => {
    setSelected((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : prev.length >= MAX_COMPARE ? prev : [...prev, sym],
    );
  };

  const exportCsv = () => {
    const lines = [
      COLUMNS.map((c) => csvCell(c.label)).join(","),
      ...sorted.map((r) => COLUMNS.map((c) => csvCell(c.csv(r))).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexus-screener.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveScreen = async () => {
    const name = window.prompt("Screen name:");
    if (!name?.trim()) return;
    setMutating(true);
    try {
      await api("/api/saved", {
        method: "POST",
        body: JSON.stringify({ kind: "screen", name: name.trim(), criteria: JSON.stringify(filters) }),
      });
      savedApi.retry();
    } finally {
      setMutating(false);
    }
  };

  const applyScreen = (id: string) => {
    setAppliedId(id);
    const s = (savedApi.data ?? []).find((x) => x.id === id);
    if (!s) return;
    try {
      setFilters(sanitizeCriteria(JSON.parse(s.criteria)));
    } catch { /* corrupt criteria — keep current filters */ }
  };

  const deleteScreen = async () => {
    if (!appliedId) return;
    setMutating(true);
    try {
      await api("/api/saved", { method: "POST", body: JSON.stringify({ kind: "deleteScreen", id: appliedId }) });
      setAppliedId("");
      savedApi.retry();
    } finally {
      setMutating(false);
    }
  };

  const selectedRows = selected
    .map((sym) => rows.find((r) => r.symbol === sym))
    .filter((r): r is ScreenerRow => !!r);

  if (loading && !data) return <Loading label="Loading screener" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Screener">
      {rows.some((r) => r.status === "SAMPLE") && <SampleBanner />}

      {/* Filter panel (collapsible) */}
      <div className="border-b border-nx-border">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className="flex w-full items-center justify-between bg-nx-panel-2 px-2 py-1 text-left"
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-nx-amber">
            {panelOpen ? "▾" : "▸"} Filters
          </span>
          <span className="text-[9px] tabular-nums text-nx-faint">
            {filtered.length} of {rows.length} match
          </span>
        </button>
        {panelOpen && (
          <div className="space-y-1 px-2 py-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <FilterInput label="MktCap min $M" value={filters.mcapMin} onChange={(v) => set("mcapMin", v)} width="w-20" />
              <FilterInput label="max $M" value={filters.mcapMax} onChange={(v) => set("mcapMax", v)} width="w-20" />
              <FilterInput label="Price min" value={filters.priceMin} onChange={(v) => set("priceMin", v)} />
              <FilterInput label="max" value={filters.priceMax} onChange={(v) => set("priceMax", v)} />
              <FilterInput label="AvgVol min" value={filters.avgVolMin} onChange={(v) => set("avgVolMin", v)} width="w-24" />
              <FilterInput label="Chg% min" value={filters.changePctMin} onChange={(v) => set("changePctMin", v)} />
              <FilterInput label="P/E min" value={filters.peMin} onChange={(v) => set("peMin", v)} width="w-12" />
              <FilterInput label="max" value={filters.peMax} onChange={(v) => set("peMax", v)} width="w-12" />
              <FilterInput label="Yield min %" value={filters.divYieldMin} onChange={(v) => set("divYieldMin", v)} width="w-12" />
              <FilterInput label="RevGr min %" value={filters.revGrowthMin} onChange={(v) => set("revGrowthMin", v)} width="w-12" />
              <FilterInput label="GM min %" value={filters.grossMarginMin} onChange={(v) => set("grossMarginMin", v)} width="w-12" />
              <FilterInput label="ROE min %" value={filters.roeMin} onChange={(v) => set("roeMin", v)} width="w-12" />
              <FilterInput label="RSI min" value={filters.rsiMin} onChange={(v) => set("rsiMin", v)} width="w-12" />
              <FilterInput label="max" value={filters.rsiMax} onChange={(v) => set("rsiMax", v)} width="w-12" />
              <FilterInput label="IV min %" value={filters.ivMin} onChange={(v) => set("ivMin", v)} width="w-12" />
              <FilterInput label="OptVol min" value={filters.optVolMin} onChange={(v) => set("optVolMin", v)} width="w-20" />
              <FilterInput label="OptOI min" value={filters.optOiMin} onChange={(v) => set("optOiMin", v)} width="w-20" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[9px] text-nx-muted">Sectors</span>
              {sectors.map((s) => (
                <label key={s} className="flex items-center gap-1 text-[9px] text-nx-text">
                  <input
                    type="checkbox"
                    checked={filters.sectors.includes(s)}
                    onChange={() => {
                      setAppliedId("");
                      setFilters((f) => ({
                        ...f,
                        sectors: f.sectors.includes(s) ? f.sectors.filter((x) => x !== s) : [...f.sectors, s],
                      }));
                    }}
                    className="accent-nx-amber"
                  />
                  {s}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setFilters(EMPTY_FILTERS); setAppliedId(""); }}
                className="border border-nx-border px-2 py-0.5 text-[10px] text-nx-muted hover:text-nx-text"
              >
                Reset
              </button>
              <button
                onClick={() => void saveScreen()}
                disabled={mutating}
                className="border border-nx-border px-2 py-0.5 text-[10px] text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40"
              >
                Save screen
              </button>
              <select
                value={appliedId}
                onChange={(e) => applyScreen(e.target.value)}
                aria-label="Apply saved screen"
                className="bg-nx-inset px-1 py-0.5 text-[10px] text-nx-text focus:outline-none"
              >
                <option value="">Saved screens…</option>
                {(savedApi.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button
                onClick={() => void deleteScreen()}
                disabled={!appliedId || mutating}
                className="border border-nx-border px-2 py-0.5 text-[10px] text-nx-muted hover:text-nx-down disabled:opacity-40"
              >
                Delete screen
              </button>
              <button
                onClick={exportCsv}
                className="ml-auto border border-nx-border px-2 py-0.5 text-[10px] text-nx-cyan hover:bg-nx-panel-2"
              >
                Export CSV ({sorted.length})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Results table (virtualized) */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        {sorted.length === 0 ? (
          <EmptyState message="No matches — relax filters" hint="Reset clears all criteria" />
        ) : (
          <table className="nx-table" aria-label="Screener results">
            <thead className="sticky top-0 z-10">
              <tr>
                <th aria-label="Select" />
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    aria-sort={sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={`uppercase tracking-wider hover:text-nx-text ${sortKey === c.key ? "text-nx-amber" : ""}`}
                      aria-label={`Sort by ${c.label}`}
                    >
                      {c.label} {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {startIdx > 0 && (
                <tr aria-hidden style={{ height: startIdx * ROW_H }}>
                  <td colSpan={COLUMNS.length + 1} className="border-0 p-0" />
                </tr>
              )}
              {visible.map((r) => (
                <tr
                  key={r.symbol}
                  tabIndex={0}
                  style={{ height: ROW_H }}
                  onClick={() => open("security", r.symbol)}
                  onKeyDown={(e) => e.key === "Enter" && open("security", r.symbol)}
                  className="cursor-pointer whitespace-nowrap"
                  aria-label={`${r.symbol} ${fmtPrice(r.price)} ${fmtPct(r.changePct)}`}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.symbol)}
                      disabled={!selected.includes(r.symbol) && selected.length >= MAX_COMPARE}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(r.symbol)}
                      aria-label={`Select ${r.symbol} for comparison`}
                      className="accent-nx-amber"
                    />
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))}
              {endIdx < sorted.length && (
                <tr aria-hidden style={{ height: (sorted.length - endIdx) * ROW_H }}>
                  <td colSpan={COLUMNS.length + 1} className="border-0 p-0" />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Comparison bar */}
      {selectedRows.length > 0 && (
        <div className="border-t border-nx-border-strong bg-nx-panel-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="text-[9px] uppercase tracking-widest text-nx-amber">
              Compare {selectedRows.length}/{MAX_COMPARE}
            </span>
            {selectedRows.map((r) => (
              <span key={r.symbol} className="flex items-center gap-1 border border-nx-border px-1 text-[10px] text-nx-cyan">
                {r.symbol}
                <button
                  onClick={() => toggleSelect(r.symbol)}
                  aria-label={`Remove ${r.symbol} from comparison`}
                  className="text-nx-faint hover:text-nx-down"
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              onClick={() => setCompareOpen((v) => !v)}
              aria-expanded={compareOpen}
              className={`ml-auto border px-2 py-0.5 text-[10px] ${
                compareOpen ? "border-nx-amber/50 text-nx-amber" : "border-nx-border text-nx-muted hover:text-nx-text"
              }`}
            >
              {compareOpen ? "▾ Hide compare" : "▸ Compare"}
            </button>
          </div>
          {compareOpen && (
            <div className="overflow-x-auto px-2 pb-1">
              <table className="nx-table" aria-label="Comparison">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {selectedRows.map((r) => (
                      <th key={r.symbol} className="text-nx-cyan">{r.symbol}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Price", (r: ScreenerRow) => fmtPrice(r.price, "")],
                      ["Chg%", (r: ScreenerRow) => `${dirGlyph(r.changePct)} ${fmtPct(r.changePct)}`],
                      ["P/E", (r: ScreenerRow) => fmtNum(r.peRatio, 1)],
                      ["Yield", (r: ScreenerRow) => (r.dividendYield == null ? "—" : fmtPct(r.dividendYield, 2, false))],
                      ["RSI14", (r: ScreenerRow) => fmtNum(r.rsi14, 1)],
                      ["IV30", (r: ScreenerRow) => (r.iv30 == null ? "—" : fmtPct(r.iv30, 1, false))],
                    ] as [string, (r: ScreenerRow) => string][]
                  ).map(([label, fn]) => (
                    <tr key={label}>
                      <td className="text-nx-muted">{label}</td>
                      {selectedRows.map((r) => (
                        <td key={r.symbol} className="tabular-nums text-nx-text">{fn(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
