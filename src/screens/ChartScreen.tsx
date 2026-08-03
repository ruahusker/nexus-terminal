"use client";

// CHART — advanced charting: candle/line/area/OHLC, ranges, overlays
// (SMA/EMA/Bollinger/volume), RSI + MACD panes, % change comparisons,
// earnings markers, save/load layouts, persistent drawing tools
// (trendline/ray/hline/rect/fib). Powered by lightweight-charts v5.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { EmptyState, ErrorState, Loading, ProvenanceBadge, SampleBanner, useApi } from "@/components/ui";
import { api } from "@/lib/client";
import { dirClass, dirGlyph, fmtPct, fmtPrice } from "@/lib/format";
import { bollinger, ema, macd, rsi, sma } from "@/lib/indicators";
interface BarsResponse { bars: import("@/lib/types").Bar[]; provider: string; status: string; asOf: string }
import type { Bar, BarInterval, Fundamentals, Quote } from "@/lib/types";
import { apiPath } from "@/lib/basePath";

const INTERVAL_SEC: Record<BarInterval, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86_400, "1wk": 604_800,
};

/** Fold a live quote tick into the bar series: update the forming bar, or
 *  roll a new one when the tick crosses an interval boundary. */
function mergeTick(bars: Bar[], q: Quote, sec: number): Bar[] {
  const last = bars[bars.length - 1];
  if (!last || !(q.price > 0)) return bars;
  // Weekly boundaries aren't unix-aligned — always update the forming bar.
  const t = sec === 604_800 ? last.time : Math.floor(Math.floor(Date.now() / 1000) / sec) * sec;
  if (t <= last.time) {
    const upd: Bar = {
      ...last,
      close: q.price,
      high: Math.max(last.high, q.price),
      low: Math.min(last.low, q.price),
      volume: sec === 86_400 && q.volume > 0 ? q.volume : last.volume,
    };
    return upd === last || (upd.close === last.close && upd.high === last.high && upd.low === last.low && upd.volume === last.volume)
      ? bars
      : [...bars.slice(0, -1), upd];
  }
  return [...bars, { time: t, open: last.close, high: Math.max(last.close, q.price), low: Math.min(last.close, q.price), close: q.price, volume: 0 }];
}
import {
  COMPARE_COLORS,
  RANGES,
  earningsMarkers,
  intervalForRange,
  parseSettings,
  toClosePoints,
  toIndicatorPoints,
  toPctChangePoints,
  toTs,
  type ChartRange,
  type ChartSettings,
  type ChartType,
} from "./chartUtils";
import {
  HIT_TOLERANCE,
  TOOL_COLORS,
  drawHandle,
  hitTestDrawing,
  renderDrawing,
  timeToUnix,
  type Anchor,
  type Drawing,
  type DrawingTool,
  type PxPoint,
  type ToolMode,
} from "./drawingTools";

type MainSeriesApi = ISeriesApi<"Candlestick"> | ISeriesApi<"Bar"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;

interface SavedLayout {
  id: string;
  name: string;
  symbol: string;
  settings: string;
}

interface OhlcLegend {
  o: number;
  h: number;
  l: number;
  c: number;
}

const BTN = "border border-nx-border px-1.5 py-0.5 text-[10px]";
const BTN_ON = "bg-nx-panel-2 text-nx-amber border-nx-amber/50";
const BTN_OFF = "text-nx-muted hover:text-nx-text";

const DRAW_TOOLS: { mode: ToolMode; label: string }[] = [
  { mode: "POINTER", label: "Pointer" },
  { mode: "TRENDLINE", label: "Trend" },
  { mode: "RAY", label: "Ray" },
  { mode: "HLINE", label: "HLine" },
  { mode: "RECT", label: "Rect" },
  { mode: "FIB", label: "Fib" },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button aria-pressed={on} onClick={onClick} className={`${BTN} ${on ? BTN_ON : BTN_OFF}`}>
      {label}
    </button>
  );
}

export default function ChartScreen({ symbol = "SPY" }: { symbol?: string }) {
  const sym = (symbol || "SPY").toUpperCase();

  const [chartType, setChartType] = useState<ChartType>("candles");
  const [range, setRange] = useState<ChartRange>("1Y");
  const [showVol, setShowVol] = useState(true);
  const [showSma20, setShowSma20] = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showEma200, setShowEma200] = useState(false);
  const [showBb, setShowBb] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [cmpInput, setCmpInput] = useState("");
  const [legend, setLegend] = useState<OhlcLegend | null>(null);
  const [layoutId, setLayoutId] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Drawing tools ────────────────────────────────────────────────────────
  // React state drives the toolbar; refs mirror it so the chart-creation
  // effect (which owns the canvas redraw loop) always reads fresh values.
  const [tool, setTool] = useState<ToolMode>("POINTER");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolRef = useRef<ToolMode>("POINTER");
  const drawingsRef = useRef<Drawing[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Anchor | null>(null); // first anchor, awaiting second click
  const hoverRef = useRef<Anchor | null>(null); // live preview anchor under the mouse
  const barsRef = useRef<Bar[]>([]);
  const symRef = useRef(sym);
  const tempIdRef = useRef(0);
  const redrawRef = useRef<() => void>(() => {});
  const projectRef = useRef<((a: Anchor) => PxPoint | null) | null>(null);
  const priceToYRef = useRef<((price: number) => number | null) | null>(null);
  const actionsRef = useRef({ cancel: () => {}, deleteSelected: () => {} });

  useEffect(() => {
    drawingsRef.current = drawings;
    redrawRef.current();
  }, [drawings]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    redrawRef.current();
  }, [selectedId]);
  useEffect(() => {
    toolRef.current = tool;
    redrawRef.current();
  }, [tool]);
  useEffect(() => {
    symRef.current = sym;
  }, [sym]);

  // Load persisted drawings per symbol. Non-blocking: the chart works
  // regardless of whether this fetch succeeds. Local state is the source of
  // truth afterwards (commits POST immediately and update state).
  useEffect(() => {
    let cancelled = false;
    setDrawings([]);
    setSelectedId(null);
    setDrawError(null);
    pendingRef.current = null;
    hoverRef.current = null;
    api<Drawing[]>(`/api/drawings?symbol=${encodeURIComponent(sym)}`)
      .then((d) => {
        if (!cancelled) setDrawings(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sym]);

  // Keyboard: Esc cancels an in-progress drawing / deactivates the tool;
  // Delete/Backspace deletes the selected drawing. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") actionsRef.current.cancel();
      else if (e.key === "Delete" || e.key === "Backspace") actionsRef.current.deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [intervalOverride, setIntervalOverride] = useState<BarInterval | null>(null);
  const interval = intervalOverride ?? intervalForRange(range);
  const cmpKey = compare.join(",");

  const barsPath = `/api/bars?symbol=${encodeURIComponent(sym)}&interval=${interval}&range=${range}`;
  const { data: barsResp, error, loading, retry } = useApi<BarsResponse>(barsPath, 300_000);
  const apiBars = barsResp?.bars ?? null;
  // Live bars: API history plus the streaming tick folded into the forming bar.
  const [liveBars, setLiveBars] = useState<Bar[] | null>(null);
  useEffect(() => setLiveBars(apiBars), [apiBars]);
  const bars = liveBars ?? apiBars;
  useEffect(() => {
    const es = new EventSource(apiPath(`/api/stream?symbols=${encodeURIComponent(sym)}`));
    es.onmessage = (ev) => {
      try {
        const qs = JSON.parse(ev.data as string) as Quote[];
        const q = qs.find((x) => x.symbol === sym);
        if (q) setLiveBars((prev) => (prev && prev.length > 0 ? mergeTick(prev, q, INTERVAL_SEC[interval]) : prev));
      } catch { /* malformed tick */ }
    };
    return () => es.close();
  }, [sym, interval]);
  const { data: fundamentals } = useApi<Fundamentals>(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`);
  const cmpPath = (s: string | undefined) =>
    s ? `/api/bars?symbol=${encodeURIComponent(s)}&interval=${interval}&range=${range}` : null;
  const cmp0 = useApi<BarsResponse>(cmpPath(compare[0]));
  const cmp1 = useApi<BarsResponse>(cmpPath(compare[1]));
  const cmp2 = useApi<BarsResponse>(cmpPath(compare[2]));
  const layoutsApi = useApi<SavedLayout[]>("/api/saved?kind=charts");

  useEffect(() => {
    barsRef.current = bars ?? [];
  }, [bars]);

  // ── Indicator computations (memoized over closes) ────────────────────────
  const closes = useMemo(() => (bars ?? []).map((b) => b.close), [bars]);
  const sma20v = useMemo(() => (showSma20 ? sma(closes, 20) : null), [closes, showSma20]);
  const sma50v = useMemo(() => (showSma50 ? sma(closes, 50) : null), [closes, showSma50]);
  const ema200v = useMemo(() => (showEma200 ? ema(closes, 200) : null), [closes, showEma200]);
  const bb = useMemo(() => (showBb ? bollinger(closes) : null), [closes, showBb]);
  const rsiV = useMemo(() => (showRsi ? rsi(closes) : null), [closes, showRsi]);
  const macdV = useMemo(() => (showMacd ? macd(closes) : null), [closes, showMacd]);
  const earningsDates = useMemo(
    () => (fundamentals?.earningsCalendar ?? []).map((e) => e.date),
    [fundamentals],
  );

  // ── Chart instance ────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<MainSeriesApi | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbURef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const cmpRefs = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Create the chart. Recreated (never leaked) when the structure changes:
  // symbol, range/interval, chart type, sub-pane toggles, comparison count.
  // Overlay visibility and data are applied by the effects below.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0b" },
        textColor: "#71717a",
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        panes: { separatorColor: "#232326", separatorHoverColor: "#34343a" },
      },
      grid: { vertLines: { color: "#232326" }, horzLines: { color: "#232326" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#232326" },
      timeScale: { borderColor: "#232326", timeVisible: true, secondsVisible: false, rightOffset: 2 },
    });
    chartRef.current = chart;

    let main: MainSeriesApi;
    if (chartType === "candles") {
      main = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
    } else if (chartType === "bars") {
      main = chart.addSeries(BarSeries, { upColor: "#22c55e", downColor: "#ef4444" });
    } else if (chartType === "area") {
      main = chart.addSeries(AreaSeries, {
        lineColor: "#f5a524",
        topColor: "rgba(245,165,36,0.25)",
        bottomColor: "rgba(245,165,36,0.02)",
        lineWidth: 2,
      });
    } else {
      main = chart.addSeries(LineSeries, { color: "#f5a524", lineWidth: 2 });
    }
    mainRef.current = main;

    // Volume: histogram on the main pane, bottom strip via scale margins.
    volRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const overlay = (color: string, dashed = false) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    sma20Ref.current = overlay("#f5a524");
    sma50Ref.current = overlay("#22d3ee");
    ema200Ref.current = overlay("#c084fc");
    bbURef.current = overlay("#71717a", true);
    bbMRef.current = overlay("#52525b");
    bbLRef.current = overlay("#71717a", true);

    markersRef.current = createSeriesMarkers(main as ISeriesApi<SeriesType, Time>, []);

    // Sub-panes: RSI then MACD, each its own pane below the main one.
    let pane = 1;
    if (showRsi) {
      const r = chart.addSeries(
        LineSeries,
        { color: "#c084fc", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false },
        pane,
      );
      r.createPriceLine({ price: 70, color: "#52525b", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      r.createPriceLine({ price: 30, color: "#52525b", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      rsiRef.current = r;
      pane++;
    }
    if (showMacd) {
      macdLineRef.current = chart.addSeries(
        LineSeries,
        { color: "#22d3ee", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false },
        pane,
      );
      macdSignalRef.current = chart.addSeries(
        LineSeries,
        { color: "#f5a524", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false },
        pane,
      );
      macdHistRef.current = chart.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false },
        pane,
      );
    }

    // Comparison lines: % change on an invisible overlay scale.
    cmpRefs.current = compare.map((_, i) =>
      chart.addSeries(LineSeries, {
        color: COMPARE_COLORS[i] ?? "#22d3ee",
        lineWidth: 1,
        priceScaleId: "cmp",
        priceFormat: { type: "percent" },
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }),
    );
    if (compare.length > 0) {
      chart.priceScale("cmp").applyOptions({ visible: false });
    }

    const onMove = (param: MouseEventParams<Time>) => {
      const m = mainRef.current;
      if (!m) return;
      const d = param.seriesData.get(m as ISeriesApi<SeriesType, Time>);
      if (d && "open" in d) {
        setLegend({ o: d.open, h: d.high, l: d.low, c: d.close });
      } else if (d && "value" in d && typeof d.value === "number") {
        setLegend({ o: d.value, h: d.value, l: d.value, c: d.value });
      } else {
        setLegend(null);
      }
    };
    chart.subscribeCrosshairMove(onMove);

    // ── Drawing overlay: canvas over pane 0, redrawn on pan/zoom/resize ────
    // Anchors live in time/price; every redraw re-projects them to pixels so
    // drawings track pan, zoom, timeframe and pane layout changes.
    const MARGIN = 2000; // px beyond the canvas for clamping off-screen anchors
    const priceToY = (price: number): number | null => {
      const c = main.priceToCoordinate(price);
      return c == null ? null : (c as number);
    };
    const paneH = () => chart.panes()[0]?.getHeight() ?? el.clientHeight - chart.timeScale().height();
    const toPixel = (a: Anchor): PxPoint | null => {
      const W = el.clientWidth;
      const H = paneH();
      let x: number | null = chart.timeScale().timeToCoordinate(toTs(a.time));
      let y: number | null = main.priceToCoordinate(a.price);
      if (x == null) {
        // Anchor outside the loaded bars: clamp to the side it falls on.
        const bs = barsRef.current;
        const first = bs[0]?.time;
        const last = bs[bs.length - 1]?.time;
        if (first == null || last == null) return null;
        x = a.time < first ? -MARGIN : W + MARGIN;
      }
      if (y == null) {
        const top = main.coordinateToPrice(0);
        if (top == null) return null;
        y = a.price > top ? -MARGIN : H + MARGIN;
      }
      return { x, y };
    };
    const drawOverlay = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = el.clientWidth;
      const H = paneH();
      if (W <= 0 || H <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(W * dpr);
      const ph = Math.round(H * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      canvas.style.height = `${H}px`; // main pane only — never RSI/MACD or the time axis
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const sel = selectedIdRef.current;
      for (const d of drawingsRef.current) {
        const px = d.points.map(toPixel);
        renderDrawing(ctx, d.tool, d.points, px, {
          W,
          H,
          color: d.color ?? TOOL_COLORS[d.tool],
          selected: d.id === sel,
          priceToY,
        });
        if (d.id === sel) for (const p of px) if (p) drawHandle(ctx, p);
      }
      // In-progress preview: first anchor + live hover point, dashed.
      const t = toolRef.current;
      if (t !== "POINTER") {
        const p1 = pendingRef.current;
        const p2 = hoverRef.current;
        if (t === "HLINE" && p2) {
          renderDrawing(ctx, "HLINE", [p2], [null], { W, H, color: TOOL_COLORS.HLINE, dashed: true, priceToY });
        } else if (t !== "HLINE" && p1 && p2) {
          renderDrawing(ctx, t, [p1, p2], [toPixel(p1), toPixel(p2)], {
            W,
            H,
            color: TOOL_COLORS[t],
            dashed: true,
            priceToY,
          });
        }
        if (p1) {
          const hp = toPixel(p1);
          if (hp) drawHandle(ctx, hp);
        }
      }
    };
    let raf = 0;
    const scheduleRedraw = () => {
      if (raf === 0)
        raf = requestAnimationFrame(() => {
          raf = 0;
          drawOverlay();
        });
    };
    redrawRef.current = scheduleRedraw;
    projectRef.current = toPixel;
    priceToYRef.current = priceToY;
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRedraw);
    const resizeObs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleRedraw) : null;
    resizeObs?.observe(el);
    scheduleRedraw();

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleRedraw);
      resizeObs?.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
      redrawRef.current = () => {};
      projectRef.current = null;
      priceToYRef.current = null;
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
      ema200Ref.current = null;
      bbURef.current = null;
      bbMRef.current = null;
      bbLRef.current = null;
      rsiRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      cmpRefs.current = [];
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, interval, range, chartType, showRsi, showMacd, cmpKey]);

  // Push data into the series. Declared after the creation effect so refs are
  // set; re-runs on any structural change too (deps are a superset).
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !bars) return;

    if (chartType === "candles" || chartType === "bars") {
      const ohlc = bars.map((b) => ({ time: toTs(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
      (main as ISeriesApi<"Candlestick">).setData(ohlc);
    } else {
      (main as ISeriesApi<"Line">).setData(toClosePoints(bars));
    }

    volRef.current?.setData(
      bars.map((b) => ({
        time: toTs(b.time),
        value: b.volume,
        color: b.close >= b.open ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)",
      })),
    );
    sma20Ref.current?.setData(sma20v ? toIndicatorPoints(bars, sma20v) : []);
    sma50Ref.current?.setData(sma50v ? toIndicatorPoints(bars, sma50v) : []);
    ema200Ref.current?.setData(ema200v ? toIndicatorPoints(bars, ema200v) : []);
    bbURef.current?.setData(bb ? toIndicatorPoints(bars, bb.upper) : []);
    bbMRef.current?.setData(bb ? toIndicatorPoints(bars, bb.middle) : []);
    bbLRef.current?.setData(bb ? toIndicatorPoints(bars, bb.lower) : []);
    rsiRef.current?.setData(rsiV ? toIndicatorPoints(bars, rsiV) : []);
    macdLineRef.current?.setData(macdV ? toIndicatorPoints(bars, macdV.macd) : []);
    macdSignalRef.current?.setData(macdV ? toIndicatorPoints(bars, macdV.signal) : []);
    macdHistRef.current?.setData(
      macdV
        ? toIndicatorPoints(bars, macdV.histogram).map((p) => ({
            ...p,
            color: p.value >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)",
          }))
        : [],
    );

    const cmpData = [cmp0.data?.bars, cmp1.data?.bars, cmp2.data?.bars];
    cmpRefs.current.forEach((s, i) => {
      const d = cmpData[i];
      s.setData(d ? toPctChangePoints(d) : []);
    });

    markersRef.current?.setMarkers(earningsMarkers(bars, earningsDates));
    chart.timeScale().fitContent();
    setLegend(null);
    redrawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bars, chartType, sma20v, sma50v, ema200v, bb, rsiV, macdV,
    cmp0.data?.bars, cmp1.data?.bars, cmp2.data?.bars, earningsDates,
    sym, interval, range, showRsi, showMacd, cmpKey,
  ]);

  // Overlay visibility + price-scale mode, applied without chart recreation.
  useEffect(() => {
    volRef.current?.applyOptions({ visible: showVol });
    sma20Ref.current?.applyOptions({ visible: showSma20 });
    sma50Ref.current?.applyOptions({ visible: showSma50 });
    ema200Ref.current?.applyOptions({ visible: showEma200 });
    bbURef.current?.applyOptions({ visible: showBb });
    bbMRef.current?.applyOptions({ visible: showBb });
    bbLRef.current?.applyOptions({ visible: showBb });
    chartRef.current
      ?.priceScale("right")
      .applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVol, showSma20, showSma50, showEma200, showBb, logScale, sym, interval, range, chartType, showRsi, showMacd, cmpKey]);

  // ── Layout save/load ─────────────────────────────────────────────────────
  const currentSettings = (): ChartSettings => ({
    chartType,
    range,
    volume: showVol,
    sma20: showSma20,
    sma50: showSma50,
    ema200: showEma200,
    bollinger: showBb,
    rsi: showRsi,
    macd: showMacd,
    logScale,
    compare,
  });

  const saveLayout = async () => {
    const name = window.prompt("Chart layout name:");
    if (!name?.trim()) return;
    setSaving(true);
    try {
      await api("/api/saved", {
        method: "POST",
        body: JSON.stringify({ kind: "chart", name: name.trim(), symbol: sym, settings: JSON.stringify(currentSettings()) }),
      });
      layoutsApi.retry();
    } finally {
      setSaving(false);
    }
  };

  const applyLayout = (id: string) => {
    setLayoutId(id);
    const layout = (layoutsApi.data ?? []).find((l) => l.id === id);
    if (!layout) return;
    const s = parseSettings(layout.settings);
    if (!s) return;
    setChartType(s.chartType);
    setRange(s.range);
    setShowVol(s.volume);
    setShowSma20(s.sma20);
    setShowSma50(s.sma50);
    setShowEma200(s.ema200);
    setShowBb(s.bollinger);
    setShowRsi(s.rsi);
    setShowMacd(s.macd);
    setLogScale(s.logScale);
    setCompare(s.compare.slice(0, 3));
  };

  const deleteLayout = async () => {
    if (!layoutId) return;
    setSaving(true);
    try {
      await api("/api/saved", { method: "POST", body: JSON.stringify({ kind: "deleteChart", id: layoutId }) });
      setLayoutId("");
      layoutsApi.retry();
    } finally {
      setSaving(false);
    }
  };

  const addCompare = () => {
    const s = cmpInput.trim().toUpperCase();
    setCmpInput("");
    if (!s || compare.includes(s) || compare.length >= 3) return;
    setCompare([...compare, s]);
  };

  // ── Drawing tool actions ─────────────────────────────────────────────────
  const selectTool = (mode: ToolMode) => {
    setTool(mode);
    pendingRef.current = null;
    hoverRef.current = null;
    if (mode !== "POINTER") setSelectedId(null);
    redrawRef.current();
  };

  // Optimistic commit: render immediately under a temp id, swap in the
  // server row on success; on failure keep it locally and say so.
  const commitDrawing = (drawTool: DrawingTool, points: Anchor[]) => {
    const color = TOOL_COLORS[drawTool];
    const tempId = `local-${++tempIdRef.current}`;
    const forSym = sym;
    const clean = points.map((p) => ({ time: Math.round(p.time), price: p.price }));
    setDrawings((prev) => [...prev, { id: tempId, symbol: forSym, tool: drawTool, points: clean, color }]);
    api<Drawing>("/api/drawings", {
      method: "POST",
      body: JSON.stringify({ symbol: forSym, tool: drawTool, points: clean, color }),
    })
      .then((saved) => {
        if (symRef.current === forSym)
          setDrawings((prev) => prev.map((d) => (d.id === tempId ? { ...saved, points: clean } : d)));
      })
      .catch((err: unknown) => {
        if (symRef.current === forSym)
          setDrawError(`Save failed: ${err instanceof Error ? err.message : "unknown error"} — drawing kept locally`);
      });
  };

  const deleteDrawing = async (id: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    if (id.startsWith("local-")) return; // never reached the server
    try {
      await api("/api/drawings", { method: "DELETE", body: JSON.stringify({ id }) });
    } catch (err) {
      setDrawError(`Delete failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  const clearAllDrawings = async () => {
    const prev = drawingsRef.current;
    if (prev.length === 0) return;
    if (!window.confirm(`Delete all ${prev.length} drawing(s) for ${sym}?`)) return;
    setDrawings([]);
    setSelectedId(null);
    try {
      await api("/api/drawings", { method: "DELETE", body: JSON.stringify({ symbol: sym }) });
    } catch (err) {
      setDrawings(prev); // don't silently drop on failure
      setDrawError(`Clear failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  // Latest-action refs for the window keydown listener (registered once).
  useEffect(() => {
    actionsRef.current = {
      cancel: () => {
        if (pendingRef.current) {
          pendingRef.current = null;
          hoverRef.current = null;
          redrawRef.current();
        } else if (toolRef.current !== "POINTER") {
          selectTool("POINTER");
        }
      },
      deleteSelected: () => {
        const id = selectedIdRef.current;
        if (id) void deleteDrawing(id);
      },
    };
  });

  // Chart-area click with the pointer tool: select a drawing within ~6px.
  const onChartAreaClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (toolRef.current !== "POINTER") return;
    const project = projectRef.current;
    const priceToY = priceToYRef.current;
    const el = containerRef.current;
    if (!project || !priceToY || !el) return;
    const rect = el.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const list = drawingsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]!;
      if (hitTestDrawing(d.tool, d.points, d.points.map(project), p, HIT_TOLERANCE, priceToY)) {
        setSelectedId(d.id);
        return;
      }
    }
    setSelectedId(null);
  };

  // Canvas click with a drawing tool active: set anchors / commit.
  const onCanvasClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const t = toolRef.current;
    if (t === "POINTER") return;
    const chart = chartRef.current;
    const main = mainRef.current;
    const el = containerRef.current;
    if (!chart || !main || !el) return;
    const rect = el.getBoundingClientRect();
    const time = timeToUnix(chart.timeScale().coordinateToTime(e.clientX - rect.left));
    const price = main.coordinateToPrice(e.clientY - rect.top);
    if (price == null) return;
    if (t === "HLINE") {
      // Single-click commit; the time anchor is only a placeholder.
      commitDrawing("HLINE", [{ time: time ?? Math.round(Date.now() / 1000), price }]);
      return;
    }
    if (time == null) return;
    const anchor: Anchor = { time, price };
    const p1 = pendingRef.current;
    if (!p1) {
      pendingRef.current = anchor;
      hoverRef.current = anchor;
      redrawRef.current();
      return;
    }
    pendingRef.current = null;
    hoverRef.current = null;
    commitDrawing(t, [p1, anchor]);
  };

  // Live preview while a tool is active (dashed shape follows the mouse).
  const onCanvasMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const t = toolRef.current;
    if (t === "POINTER") return;
    const chart = chartRef.current;
    const main = mainRef.current;
    const el = containerRef.current;
    if (!chart || !main || !el) return;
    const rect = el.getBoundingClientRect();
    const time = timeToUnix(chart.timeScale().coordinateToTime(e.clientX - rect.left));
    const price = main.coordinateToPrice(e.clientY - rect.top);
    if (price == null) return;
    hoverRef.current = { time: time ?? pendingRef.current?.time ?? 0, price };
    redrawRef.current();
  };

  // ── Header values ────────────────────────────────────────────────────────
  const last = bars?.[bars.length - 1];
  const prev = bars?.[bars.length - 2];
  const change = last && prev ? last.close - prev.close : null;
  const changePct = last && prev && prev.close !== 0 ? (last.close - prev.close) / prev.close : null;
  const shown = legend ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close } : null);

  // NOTE: the chart container must stay mounted during loading so the
  // chart-creation effect has a live element — loading/error render as overlays.

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label={`Chart ${sym}`}>
{barsResp?.status === "SAMPLE" && <SampleBanner />}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-nx-border-strong bg-nx-panel-2 px-2 py-1">
        <span className="text-[12px] font-semibold text-nx-cyan">{sym}</span>
        <span className="text-[12px] tabular-nums text-nx-text-bright">{last ? fmtPrice(last.close, "") : "—"}</span>
        <span className={`text-[11px] tabular-nums ${dirClass(changePct)}`}>
          {changePct != null ? `${dirGlyph(changePct)} ${fmtPrice(Math.abs(change ?? 0), "")} (${fmtPct(changePct)})` : "—"}
        </span>
        <span className="ml-auto">
          <ProvenanceBadge
            prov={{
              provider: barsResp?.provider ?? "demo",
              status: (barsResp?.status ?? "SAMPLE") as import("@/lib/types").DataStatus,
              asOf: barsResp?.asOf ?? new Date().toISOString(),
            }}
          />
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-nx-border px-2 py-1" role="toolbar" aria-label="Chart controls">
        <div className="flex gap-px" role="group" aria-label="Chart type">
          {(["candles", "line", "area", "bars"] as ChartType[]).map((t) => (
            <button
              key={t}
              aria-pressed={chartType === t}
              onClick={() => setChartType(t)}
              className={`${BTN} ${chartType === t ? BTN_ON : BTN_OFF}`}
            >
              {t === "candles" ? "Candle" : t === "bars" ? "OHLC" : t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <div className="flex gap-px" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => {
                setRange(r);
                setIntervalOverride(null); // back to the sensible default for this range
              }}
              className={`${BTN} ${range === r ? BTN_ON : BTN_OFF}`}
            >
              {r}
            </button>
          ))}
        </div>
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <div className="flex gap-px" role="group" aria-label="Bar interval">
          {(["1m", "5m", "15m", "1h", "1d", "1wk"] as BarInterval[]).map((iv) => (
            <button
              key={iv}
              aria-pressed={interval === iv}
              onClick={() => setIntervalOverride(iv)}
              className={`${BTN} ${interval === iv ? BTN_ON : BTN_OFF}`}
            >
              {iv}
            </button>
          ))}
        </div>
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <Toggle on={showVol} onClick={() => setShowVol((v) => !v)} label="Vol" />
        <Toggle on={showSma20} onClick={() => setShowSma20((v) => !v)} label="SMA20" />
        <Toggle on={showSma50} onClick={() => setShowSma50((v) => !v)} label="SMA50" />
        <Toggle on={showEma200} onClick={() => setShowEma200((v) => !v)} label="EMA200" />
        <Toggle on={showBb} onClick={() => setShowBb((v) => !v)} label="BB" />
        <Toggle on={showRsi} onClick={() => setShowRsi((v) => !v)} label="RSI" />
        <Toggle on={showMacd} onClick={() => setShowMacd((v) => !v)} label="MACD" />
        <Toggle on={logScale} onClick={() => setLogScale((v) => !v)} label="Log" />
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <span className="text-[9px] uppercase tracking-widest text-nx-faint">Draw</span>
        <div className="flex gap-px" role="group" aria-label="Drawing tools">
          {DRAW_TOOLS.map(({ mode, label }) => (
            <button
              key={mode}
              aria-pressed={tool === mode}
              onClick={() => selectTool(mode)}
              className={`${BTN} ${tool === mode ? BTN_ON : BTN_OFF}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void clearAllDrawings()}
          disabled={drawings.length === 0}
          className={`${BTN} text-nx-muted hover:text-nx-down disabled:opacity-40`}
        >
          Clear
        </button>
        {selectedId && (
          <button
            onClick={() => void deleteDrawing(selectedId)}
            aria-label="Delete selected drawing"
            className={`${BTN} border-nx-amber/50 text-nx-amber`}
          >
            ✕ 1
          </button>
        )}
        {drawError && (
          <span role="alert" className="text-[9px] text-nx-down">
            {drawError}
          </span>
        )}
      </div>

      {/* Comparison + layouts */}
      <div className="flex flex-wrap items-center gap-2 border-b border-nx-border px-2 py-1 text-[10px]">
        <input
          value={cmpInput}
          onChange={(e) => setCmpInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && addCompare()}
          placeholder="Compare…"
          aria-label="Add comparison symbol"
          className="w-20 bg-nx-inset px-1.5 py-0.5 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
        />
        <button
          onClick={addCompare}
          disabled={compare.length >= 3 || !cmpInput.trim()}
          className={`${BTN} text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40`}
        >
          + Cmp
        </button>
        {compare.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1 border border-nx-border px-1 py-px text-nx-text">
            <span className="inline-block h-2 w-2" style={{ background: COMPARE_COLORS[i] ?? "#22d3ee" }} aria-hidden />
            {s}
            <button onClick={() => setCompare(compare.filter((c) => c !== s))} aria-label={`Remove comparison ${s}`} className="text-nx-faint hover:text-nx-down">
              ✕
            </button>
          </span>
        ))}
        <span className="mx-1 h-3 w-px bg-nx-border-strong" aria-hidden />
        <button onClick={() => void saveLayout()} disabled={saving} className={`${BTN} text-nx-amber hover:bg-nx-panel-2 disabled:opacity-40`}>
          Save
        </button>
        <select
          value={layoutId}
          onChange={(e) => e.target.value && applyLayout(e.target.value)}
          aria-label="Load saved chart layout"
          className="bg-nx-inset px-1 py-0.5 text-[10px] text-nx-text focus:outline-none"
        >
          <option value="">Layouts…</option>
          {(layoutsApi.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {l.symbol}
            </option>
          ))}
        </select>
        <button
          onClick={() => void deleteLayout()}
          disabled={!layoutId || saving}
          aria-label="Delete selected layout"
          className={`${BTN} text-nx-muted hover:text-nx-down disabled:opacity-40`}
        >
          Delete
        </button>
      </div>

      {/* Chart */}
      <div className="relative min-h-0 flex-1" onClick={onChartAreaClick}>
        <div ref={containerRef} className="absolute inset-0" />
        {/* Drawing overlay: covers the main price pane only (height is set
            imperatively from pane 0). Interactive only while a tool is
            active; otherwise chart interactions pass through untouched. */}
        <canvas
          ref={canvasRef}
          aria-hidden
          className="absolute left-0 top-0 z-10"
          style={{
            width: "100%",
            pointerEvents: tool === "POINTER" ? "none" : "auto",
            cursor: tool === "POINTER" ? "default" : "crosshair",
          }}
          onClick={onCanvasClick}
          onMouseMove={onCanvasMouseMove}
        />
        {shown && (
          <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-2 text-[10px] tabular-nums" aria-live="off">
            <span className="text-nx-muted">O <span className="text-nx-text">{fmtPrice(shown.o, "")}</span></span>
            <span className="text-nx-muted">H <span className="text-nx-up">{fmtPrice(shown.h, "")}</span></span>
            <span className="text-nx-muted">L <span className="text-nx-down">{fmtPrice(shown.l, "")}</span></span>
            <span className="text-nx-muted">C <span className="text-nx-text-bright">{fmtPrice(shown.c, "")}</span></span>
          </div>
        )}
        <div className="pointer-events-none absolute right-14 top-1 z-10 text-[9px] text-nx-faint">
          {interval} · {range}
          {showRsi ? " · RSI 14" : ""}
          {showMacd ? " · MACD 12/26/9" : ""}
        </div>
        {loading && !bars && (
          <div className="absolute inset-0 z-20 bg-nx-panel">
            <Loading label={`Loading ${sym} chart`} />
          </div>
        )}
        {error && !bars && (
          <div className="absolute inset-0 z-20 bg-nx-panel">
            <ErrorState message={error} onRetry={retry} />
          </div>
        )}
        {bars && bars.length === 0 && (
          <div className="absolute inset-0 z-20 bg-nx-panel">
            <EmptyState message={`No bars for ${sym}`} hint="Try a different range or symbol" />
          </div>
        )}
      </div>

      <div className="border-t border-nx-border px-2 py-0.5 text-[9px] text-nx-faint">
        E markers = earnings dates · comparisons normalized to % change from first bar{barsResp?.status === "SAMPLE" ? " · SAMPLE DATA" : ` · ${barsResp?.provider ?? ""}`}
      </div>
    </div>
  );
}
