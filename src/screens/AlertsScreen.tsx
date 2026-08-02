"use client";

// ALERTS — create price/volume alerts, pause/resume/delete, and trigger history.
// The server evaluates active alerts every 30s against current quotes.

import { useMemo, useState } from "react";
import { EmptyState, ErrorState, Loading, SampleBanner, SectionTitle, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDateTime, fmtNum, fmtPrice, fmtRelative } from "@/lib/format";

interface AlertEvent {
  id: string;
  alertId: string;
  message: string;
  triggeredAt: string;
  value: number | null;
}

interface Alert {
  id: string;
  symbol: string;
  kind: string;
  threshold: number | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  events: AlertEvent[];
}

type AlertKind = "PRICE_ABOVE" | "PRICE_BELOW" | "PCT_MOVE" | "VOLUME_SPIKE";

const KIND_META: Record<AlertKind, { short: string; thresholdLabel: string; hint: string }> = {
  PRICE_ABOVE: { short: "Price ≥", thresholdLabel: "Price level", hint: "Fires when the last price rises to or above this level" },
  PRICE_BELOW: { short: "Price ≤", thresholdLabel: "Price level", hint: "Fires when the last price falls to or below this level" },
  PCT_MOVE: { short: "|Move| ≥ x%", thresholdLabel: "Percent move", hint: "Fires when the absolute intraday move reaches this percent (e.g. 5)" },
  VOLUME_SPIKE: { short: "Volume ≥ x× avg", thresholdLabel: "Volume multiple", hint: "Fires when volume reaches this multiple of average volume (e.g. 2)" },
};

const KIND_IDS = Object.keys(KIND_META) as AlertKind[];
const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,12}$/;

function kindLabel(kind: string, threshold: number | null): string {
  const t = threshold ?? 0;
  switch (kind) {
    case "PRICE_ABOVE": return "Price ≥";
    case "PRICE_BELOW": return "Price ≤";
    case "PCT_MOVE": return `|Move| ≥ ${fmtNum(t, 1)}%`;
    case "VOLUME_SPIKE": return `Volume ≥ ${fmtNum(t, 1)}× avg`;
    default: return kind;
  }
}

function fmtThreshold(kind: string, threshold: number | null): string {
  if (threshold == null) return "—";
  if (kind === "PRICE_ABOVE" || kind === "PRICE_BELOW") return fmtPrice(threshold, "");
  if (kind === "PCT_MOVE") return `${fmtNum(threshold, 1)}%`;
  if (kind === "VOLUME_SPIKE") return `${fmtNum(threshold, 1)}×`;
  return fmtNum(threshold);
}

export default function AlertsScreen({ symbol }: { symbol?: string }) {
  const { data, error, loading, retry } = useApi<Alert[]>("/api/alerts", 30_000);
  const { data: probe } = useApi<import("@/lib/types").Quote[]>("/api/quote?symbols=SPY", 60_000);
  const probeQuote = probe?.[0];
  const [sym, setSym] = useState((symbol ?? "").toUpperCase());
  const [kind, setKind] = useState<AlertKind>("PRICE_ABOVE");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const alerts = useMemo(() => data ?? [], [data]);

  const history = useMemo(() => {
    const flat: { id: string; symbol: string; message: string; triggeredAt: string }[] = [];
    for (const a of alerts) {
      for (const ev of a.events) {
        flat.push({ id: ev.id, symbol: a.symbol, message: ev.message, triggeredAt: ev.triggeredAt });
      }
    }
    return flat.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  }, [alerts]);

  const create = async () => {
    const s = sym.trim().toUpperCase();
    if (!SYMBOL_RE.test(s)) {
      setFormError("Invalid symbol — use 1-12 letters, digits, . - ^ =");
      return;
    }
    const t = Number(threshold);
    if (!Number.isFinite(t) || t <= 0) {
      setFormError(`${KIND_META[kind].thresholdLabel} must be a positive number`);
      return;
    }
    setMutating(true);
    setFormError(null);
    try {
      await api("/api/alerts", {
        method: "POST",
        body: JSON.stringify({ symbol: s, kind, threshold: t, note: note.trim() || undefined }),
      });
      setThreshold("");
      setNote("");
      retry();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create alert");
    } finally {
      setMutating(false);
    }
  };

  const patch = async (body: object) => {
    setMutating(true);
    try {
      await api("/api/alerts", { method: "PATCH", body: JSON.stringify(body) });
      retry();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setMutating(false);
    }
  };

  const remove = (a: Alert) => {
    if (window.confirm(`Delete alert ${a.symbol} ${kindLabel(a.kind, a.threshold)}?`)) {
      void patch({ id: a.id, delete: true });
    }
  };

  if (loading && !data) return <Loading label="Loading alerts" />;
  if (error && !data) return <ErrorState message={error} onRetry={retry} />;

  const meta = KIND_META[kind];

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Alerts">
{probeQuote?.status === "SAMPLE" && <SampleBanner />}
      <div className="border-b border-nx-border px-2 py-1 text-[10px] text-nx-muted" role="note">
        Price and volume alerts are evaluated every 30 seconds against current quotes and fire toast notifications while this app is open.
      </div>

      {/* Create form */}
      <section aria-label="Create alert" className="border-b border-nx-border-strong">
        <SectionTitle>New Alert</SectionTitle>
        <div className="flex flex-wrap items-end gap-2 p-2">
          <label className="flex flex-col gap-0.5 text-[10px] text-nx-muted">
            Symbol
            <input
              value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())}
              placeholder="AAPL"
              aria-label="Alert symbol"
              className="w-24 bg-nx-inset px-2 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-nx-muted">
            Condition
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AlertKind)}
              aria-label="Alert condition"
              className="bg-nx-inset px-1 py-0.5 text-[11px] text-nx-text focus:outline-none"
            >
              {KIND_IDS.map((k) => (
                <option key={k} value={k}>{KIND_META[k].short}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-nx-muted">
            {meta.thresholdLabel}
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              placeholder={kind === "VOLUME_SPIKE" ? "2" : kind === "PCT_MOVE" ? "5" : "150.00"}
              aria-label={meta.thresholdLabel}
              className="w-24 bg-nx-inset px-2 py-0.5 text-[11px] tabular-nums text-nx-text placeholder:text-nx-faint focus:outline-none"
            />
          </label>
          <label className="flex min-w-32 flex-1 flex-col gap-0.5 text-[10px] text-nx-muted">
            Note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. breakout level"
              aria-label="Alert note"
              className="bg-nx-inset px-2 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
            />
          </label>
          <button
            onClick={() => void create()}
            disabled={mutating}
            className="border border-nx-amber/50 px-3 py-0.5 text-[11px] text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40"
          >
            Create
          </button>
        </div>
        <div className="px-2 pb-1 text-[10px] text-nx-faint">{meta.hint}</div>
        {formError && (
          <div className="px-2 pb-1 text-[10px] text-nx-down" role="alert">⚠ {formError}</div>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Active alerts */}
        <section aria-label="Configured alerts">
          <SectionTitle>Alerts ({alerts.length})</SectionTitle>
          {alerts.length === 0 ? (
            <EmptyState message="No alerts configured" hint="Create one above — it will be evaluated every 30 seconds" />
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Symbol</th><th>Condition</th><th>Threshold</th><th>Status</th><th>Last Triggered</th><th>Note</th><th />
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const last = a.events[0];
                  return (
                    <tr
                      key={a.id}
                      className={a.active ? undefined : "opacity-50"}
                      aria-label={`${a.symbol} ${kindLabel(a.kind, a.threshold)} threshold ${fmtThreshold(a.kind, a.threshold)}, ${a.active ? "active" : "paused"}`}
                    >
                      <td className="font-semibold text-nx-cyan">{a.symbol}</td>
                      <td className="text-nx-text">{kindLabel(a.kind, a.threshold)}</td>
                      <td className="tabular-nums text-nx-text-bright">{fmtThreshold(a.kind, a.threshold)}</td>
                      <td>
                        <button
                          onClick={() => void patch({ id: a.id, active: !a.active })}
                          disabled={mutating}
                          aria-label={`${a.active ? "Pause" : "Resume"} alert ${a.symbol} ${kindLabel(a.kind, a.threshold)}`}
                          aria-pressed={a.active}
                          className={`border px-2 py-px text-[10px] disabled:opacity-40 ${a.active ? "border-nx-up/40 text-nx-up" : "border-nx-border text-nx-muted hover:text-nx-text"}`}
                        >
                          {a.active ? "● Active" : "○ Paused"}
                        </button>
                      </td>
                      <td className="text-[10px] text-nx-muted" title={last ? fmtDateTime(last.triggeredAt) : undefined}>
                        {last ? fmtRelative(last.triggeredAt) : "—"}
                      </td>
                      <td className="max-w-40 truncate text-[10px] text-nx-muted">{a.note ?? ""}</td>
                      <td>
                        <button
                          onClick={() => remove(a)}
                          aria-label={`Delete alert ${a.symbol} ${kindLabel(a.kind, a.threshold)}`}
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
        </section>

        {/* History */}
        <section aria-label="Alert history">
          <SectionTitle>Trigger History</SectionTitle>
          {history.length === 0 ? (
            <EmptyState message="No alerts triggered yet" />
          ) : (
            <table className="nx-table">
              <thead>
                <tr><th>Time</th><th>Symbol</th><th>Message</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} aria-label={`${h.symbol} triggered ${fmtRelative(h.triggeredAt)}: ${h.message}`}>
                    <td className="whitespace-nowrap tabular-nums text-nx-muted">{fmtDateTime(h.triggeredAt)}</td>
                    <td className="font-semibold text-nx-cyan">{h.symbol}</td>
                    <td className="text-nx-text">{h.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
