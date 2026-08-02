// Drawing tools for the Chart screen: tool types, per-tool colors, fib
// levels, pure canvas rendering of time/price-anchored shapes, and pixel
// hit-testing for selection. No React, no lightweight-charts imports — the
// caller projects anchors to pixels and passes a price→y projector in.

export type DrawingTool = "TRENDLINE" | "RAY" | "HLINE" | "RECT" | "FIB";

/** "POINTER" = no drawing tool active (click selects existing drawings). */
export type ToolMode = "POINTER" | DrawingTool;

/** One anchor of a drawing, in chart coordinates (unix seconds + price). */
export interface Anchor {
  time: number;
  price: number;
}

/** A persisted drawing, as returned by GET /api/drawings. */
export interface Drawing {
  id: string;
  symbol: string;
  tool: DrawingTool;
  points: Anchor[];
  color: string | null;
  createdAt?: string;
}

export const TOOL_COLORS: Record<DrawingTool, string> = {
  TRENDLINE: "#f5a524",
  RAY: "#22d3ee",
  HLINE: "#c084fc",
  RECT: "#60a5fa",
  FIB: "#facc15",
};

/** Amber highlight for the selected drawing / in-progress anchor handles. */
export const SELECT_COLOR = "#f5a524";

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Pixel distance within which a click counts as hitting a drawing. */
export const HIT_TOLERANCE = 6;

export interface PxPoint {
  x: number;
  y: number;
}

export interface RenderOpts {
  W: number;
  H: number;
  color: string;
  selected?: boolean;
  dashed?: boolean;
  priceToY: (price: number) => number | null;
}

/** Normalize a lightweight-charts Time value to unix seconds (or null). */
export function timeToUnix(t: unknown): number | null {
  if (typeof t === "number" && Number.isFinite(t)) return Math.round(t);
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : Math.round(ms / 1000);
  }
  if (t && typeof t === "object" && "year" in t) {
    const bd = t as { year: number; month: number; day: number };
    return Math.round(Date.UTC(bd.year, bd.month - 1, bd.day) / 1000);
  }
  return null;
}

/** "#rrggbb" → "rgba(r,g,b,a)" (falls back to the input if malformed). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function fmtLevelPrice(p: number): string {
  const abs = Math.abs(p);
  return p.toFixed(abs >= 1 ? 2 : 4);
}

function stroke(ctx: CanvasRenderingContext2D, a: PxPoint, b: PxPoint): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Small amber square marking an anchor of a selected / in-progress drawing. */
export function drawHandle(ctx: CanvasRenderingContext2D, p: PxPoint): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = SELECT_COLOR;
  ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
  ctx.restore();
}

/**
 * Liang–Barsky clip of segment a–b to the rect [0,W]×[0,H].
 * Returns the visible sub-segment, or null if fully outside.
 */
export function clipSegment(a: PxPoint, b: PxPoint, W: number, H: number): [PxPoint, PxPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, a.x],
    [dx, W - a.x],
    [-dy, a.y],
    [dy, H - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/**
 * Clip a ray (from a through b, extending infinitely) to [0,W]×[0,H].
 * Returns the visible portion starting at a (or where the ray enters).
 */
export function clipRay(a: PxPoint, b: PxPoint, W: number, H: number): [PxPoint, PxPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  let t0 = 0;
  let t1 = Infinity;
  const checks: [number, number][] = [
    [-dx, a.x],
    [dx, W - a.x],
    [-dy, a.y],
    [dy, H - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t0) t0 = r;
      } else {
        if (r < t1) t1 = r;
      }
    }
  }
  if (t1 < t0 || !Number.isFinite(t1)) return null;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

export function distToSegment(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance to a ray starting at a and passing through b (t >= 0 only). */
export function distToRay(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, t);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Render one drawing onto the overlay canvas. `px` holds the projected
 * anchors (already clamped into an extended viewport; null = unprojectable).
 * HLINE ignores `px` and derives y from its anchor price via priceToY.
 */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  tool: DrawingTool,
  points: Anchor[],
  px: (PxPoint | null)[],
  o: RenderOpts,
): void {
  const color = o.selected ? SELECT_COLOR : o.color;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = o.selected ? 2 : 1;
  ctx.setLineDash(o.dashed ? [4, 3] : []);
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  switch (tool) {
    case "TRENDLINE": {
      const a = px[0];
      const b = px[1];
      if (!a || !b) break;
      const seg = clipSegment(a, b, o.W, o.H);
      if (seg) stroke(ctx, seg[0], seg[1]);
      break;
    }
    case "RAY": {
      const a = px[0];
      const b = px[1];
      if (!a || !b) break;
      const seg = clipRay(a, b, o.W, o.H);
      if (seg) stroke(ctx, seg[0], seg[1]);
      break;
    }
    case "HLINE": {
      const pt = points[0];
      if (!pt) break;
      const y = o.priceToY(pt.price);
      if (y == null || y < 0 || y > o.H) break;
      stroke(ctx, { x: 0, y }, { x: o.W, y });
      ctx.setLineDash([]);
      ctx.fillText(fmtLevelPrice(pt.price), o.W - 4, y - 3);
      break;
    }
    case "RECT": {
      const a = px[0];
      const b = px[1];
      if (!a || !b) break;
      const x0 = clamp(Math.min(a.x, b.x), 0, o.W);
      const x1 = clamp(Math.max(a.x, b.x), 0, o.W);
      const y0 = clamp(Math.min(a.y, b.y), 0, o.H);
      const y1 = clamp(Math.max(a.y, b.y), 0, o.H);
      if (x1 - x0 <= 0 || y1 - y0 <= 0) break;
      ctx.fillStyle = withAlpha(color, 0.12);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      break;
    }
    case "FIB": {
      const a = px[0];
      const b = px[1];
      const p0 = points[0];
      const p1 = points[1];
      if (!a || !b || !p0 || !p1) break;
      const xl = clamp(Math.min(a.x, b.x), 0, o.W);
      const xr = clamp(Math.max(a.x, b.x), 0, o.W);
      if (xr - xl <= 0) break;
      for (const f of FIB_LEVELS) {
        const price = p0.price + (p1.price - p0.price) * f;
        const y = o.priceToY(price);
        if (y == null || y < -20 || y > o.H + 20) continue;
        stroke(ctx, { x: xl, y }, { x: xr, y });
        ctx.setLineDash([]);
        const label = f === 0 || f === 1 ? `${f * 100}%` : `${(f * 100).toFixed(1)}%`;
        ctx.fillText(label, xr - 2, y - 2);
        ctx.setLineDash(o.dashed ? [4, 3] : []);
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * Pixel hit-test used by the pointer tool: is `p` within `tol` of the
 * drawing? Mirrors renderDrawing's geometry (HLINE tests the price level,
 * RECT tests its four edges, FIB tests each level line).
 */
export function hitTestDrawing(
  tool: DrawingTool,
  points: Anchor[],
  px: (PxPoint | null)[],
  p: PxPoint,
  tol: number,
  priceToY: (price: number) => number | null,
): boolean {
  switch (tool) {
    case "TRENDLINE": {
      const a = px[0];
      const b = px[1];
      return a != null && b != null && distToSegment(p, a, b) <= tol;
    }
    case "RAY": {
      const a = px[0];
      const b = px[1];
      return a != null && b != null && distToRay(p, a, b) <= tol;
    }
    case "HLINE": {
      const pt = points[0];
      if (!pt) return false;
      const y = priceToY(pt.price);
      return y != null && Math.abs(p.y - y) <= tol;
    }
    case "RECT": {
      const a = px[0];
      const b = px[1];
      if (!a || !b) return false;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      const inX = p.x >= x0 - tol && p.x <= x1 + tol;
      const inY = p.y >= y0 - tol && p.y <= y1 + tol;
      return (
        (inY && (Math.abs(p.x - x0) <= tol || Math.abs(p.x - x1) <= tol)) ||
        (inX && (Math.abs(p.y - y0) <= tol || Math.abs(p.y - y1) <= tol))
      );
    }
    case "FIB": {
      const a = px[0];
      const b = px[1];
      const p0 = points[0];
      const p1 = points[1];
      if (!a || !b || !p0 || !p1) return false;
      const xl = Math.min(a.x, b.x) - tol;
      const xr = Math.max(a.x, b.x) + tol;
      if (p.x < xl || p.x > xr) return false;
      for (const f of FIB_LEVELS) {
        const y = priceToY(p0.price + (p1.price - p0.price) * f);
        if (y != null && Math.abs(p.y - y) <= tol) return true;
      }
      return false;
    }
  }
  return false;
}
