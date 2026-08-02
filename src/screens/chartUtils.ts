// Pure helpers for the Chart screen: range→interval mapping, series point
// conversion, percent-change normalization, earnings markers, and layout
// (de)serialization. No React, no DOM — unit-testable.

import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import type { Bar, BarInterval } from "@/lib/types";

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "MAX";
export type ChartType = "candles" | "line" | "area" | "bars";

export const RANGES: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "5Y", "MAX"];

/** Sensible bar interval for a lookback range. */
export function intervalForRange(range: ChartRange): BarInterval {
  switch (range) {
    case "1D":
      return "5m";
    case "5D":
      return "15m";
    case "1M":
      return "1h";
    case "5Y":
    case "MAX":
      return "1wk";
    default:
      return "1d";
  }
}

/** Colors for comparison symbols (main series uses up/down green/red). */
export const COMPARE_COLORS = ["#22d3ee", "#c084fc", "#f472b6"] as const;

export function toTs(unixSeconds: number): UTCTimestamp {
  return unixSeconds as UTCTimestamp;
}

export interface LinePoint {
  time: UTCTimestamp;
  value: number;
}

/** Zip an indicator output ((number|null)[]) with bar times, dropping nulls. */
export function toIndicatorPoints(bars: Bar[], values: (number | null)[]): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    const b = bars[i];
    if (v != null && b) out.push({ time: toTs(b.time), value: v });
  }
  return out;
}

/** Close prices as simple line points. */
export function toClosePoints(bars: Bar[]): LinePoint[] {
  return bars.map((b) => ({ time: toTs(b.time), value: b.close }));
}

/** Percent change (as a fraction) from the first close — for comparison lines. */
export function toPctChangePoints(bars: Bar[]): LinePoint[] {
  const base = bars[0]?.close;
  if (base == null || base === 0) return [];
  return bars.map((b) => ({ time: toTs(b.time), value: b.close / base - 1 }));
}

/**
 * Earnings dates → markers below bars. Matches each ISO date to the bar
 * sharing its UTC calendar day; dates outside the loaded range are skipped.
 * Markers come out sorted by time, as the library requires.
 */
export function earningsMarkers(bars: Bar[], dates: string[]): SeriesMarker<Time>[] {
  const byDay = new Map<string, number>();
  for (const b of bars) {
    const day = new Date(b.time * 1000).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, b.time);
  }
  const out: SeriesMarker<Time>[] = [];
  const seen = new Set<string>();
  for (const d of dates) {
    const day = d.slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    const t = byDay.get(day);
    if (t != null) {
      out.push({ time: toTs(t), position: "belowBar", color: "#f5a524", shape: "circle", text: "E", size: 1 });
    }
  }
  out.sort((a, b) => (a.time as number) - (b.time as number));
  return out;
}

/** Serializable chart layout, persisted via /api/saved (kind "chart"). */
export interface ChartSettings {
  chartType: ChartType;
  range: ChartRange;
  volume: boolean;
  sma20: boolean;
  sma50: boolean;
  ema200: boolean;
  bollinger: boolean;
  rsi: boolean;
  macd: boolean;
  logScale: boolean;
  compare: string[];
}

export function parseSettings(json: string): ChartSettings | null {
  try {
    const raw = JSON.parse(json) as Partial<ChartSettings>;
    if (typeof raw !== "object" || raw === null) return null;
    const chartType: ChartType =
      raw.chartType === "line" || raw.chartType === "area" || raw.chartType === "bars" ? raw.chartType : "candles";
    const range: ChartRange = raw.range != null && (RANGES as string[]).includes(raw.range) ? raw.range : "1Y";
    const bool = (v: unknown) => v === true;
    return {
      chartType,
      range,
      volume: bool(raw.volume),
      sma20: bool(raw.sma20),
      sma50: bool(raw.sma50),
      ema200: bool(raw.ema200),
      bollinger: bool(raw.bollinger),
      rsi: bool(raw.rsi),
      macd: bool(raw.macd),
      logScale: bool(raw.logScale),
      compare: Array.isArray(raw.compare)
        ? raw.compare.filter((s): s is string => typeof s === "string").slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}
