// Terminal-grade number formatting. All functions are null-safe and locale-pinned.

export function fmtPrice(n: number | null | undefined, currency = "USD"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals = abs >= 10000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const s = n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return currency === "USD" || currency === "" ? s : `${s} ${currency}`;
}

export function fmtSigned(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function fmtPct(n: number | null | undefined, decimals = 2, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = n * 100;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = !signed ? "" : v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${s}%`;
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Compact large numbers: 1.23K / 4.56M / 7.89B / 1.23T */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [div, suffix] of units) {
    if (abs >= div) return `${(n / div).toFixed(abs / div >= 100 ? 0 : abs / div >= 10 ? 1 : 2)}${suffix}`;
  }
  return n.toLocaleString("en-US");
}

export function fmtMarketCap(n: number | null | undefined): string {
  return n == null ? "—" : `$${fmtCompact(n)}`;
}

export function fmtTime(iso: string | number | Date | null | undefined): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(iso: string | number | Date | null | undefined): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${fmtTime(d)}`;
}

export function fmtRelative(iso: string | number | Date | null | undefined): string {
  if (iso == null) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtBps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(0)}bp`;
}

/** CSS class helper for directional values. Includes a glyph so color is never the only signal. */
export function dirClass(n: number | null | undefined): string {
  if (n == null || n === 0 || !Number.isFinite(n)) return "text-nx-muted";
  return n > 0 ? "text-nx-up" : "text-nx-down";
}

export function dirGlyph(n: number | null | undefined): string {
  if (n == null || n === 0 || !Number.isFinite(n)) return " ";
  return n > 0 ? "▲" : "▼";
}
