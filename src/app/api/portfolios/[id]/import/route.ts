// CSV import. Documented format (header required):
//   symbol,side,quantity,price,date,fees,note
//   AAPL,BUY,10,150.25,2024-01-15,0,initial
// side: BUY|SELL|DEPOSIT|WITHDRAWAL. date: ISO date. fees/note optional.
// All rows are validated and sanitized; nothing partial is committed on error.

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok } from "@/lib/api";
import { symbolSchema } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

interface Row { symbol: string; side: "BUY" | "SELL" | "DEPOSIT" | "WITHDRAWAL"; quantity: number; price: number; date: Date; fees: number; note: string | null }

function parseCsv(text: string): Row[] | string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "Empty file";
  const header = (lines[0] as string).toLowerCase().split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  for (const required of ["symbol", "side", "quantity"]) {
    if (idx(required) === -1) return `Missing required column: ${required}`;
  }
  if (lines.length > 2001) return "Too many rows (max 2000)";
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] as string).split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const symRaw = cols[idx("symbol")] ?? "";
    const sym = symbolSchema.safeParse(symRaw);
    if (!sym.success) return `Row ${i + 1}: invalid symbol "${symRaw}"`;
    const sideRaw = (cols[idx("side")] ?? "").toUpperCase();
    if (!["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"].includes(sideRaw)) return `Row ${i + 1}: invalid side "${sideRaw}"`;
    const quantity = Number(cols[idx("quantity")]);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) return `Row ${i + 1}: invalid quantity`;
    const price = idx("price") !== -1 ? Number(cols[idx("price")] || 0) : 0;
    if (!Number.isFinite(price) || price < 0 || price > 1e9) return `Row ${i + 1}: invalid price`;
    const dateRaw = idx("date") !== -1 ? cols[idx("date")] : "";
    const date = dateRaw ? new Date(dateRaw) : new Date();
    if (Number.isNaN(date.getTime())) return `Row ${i + 1}: invalid date "${dateRaw}"`;
    const fees = idx("fees") !== -1 ? Number(cols[idx("fees")] || 0) : 0;
    if (!Number.isFinite(fees) || fees < 0) return `Row ${i + 1}: invalid fees`;
    const note = idx("note") !== -1 ? (cols[idx("note")] ?? "").slice(0, 200) : "";
    rows.push({ symbol: sym.data, side: sideRaw as Row["side"], quantity, price, date, fees, note: note || null });
  }
  return rows;
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const portfolio = await prisma.portfolio.findFirst({ where: { id, userId: user.id } });
    if (!portfolio) return fail(404, "NOT_FOUND", "Portfolio not found");
    const text = await req.text();
    if (text.length > 512_000) return fail(413, "TOO_LARGE", "CSV exceeds 512KB");
    const parsed = parseCsv(text);
    if (typeof parsed === "string") return fail(400, "CSV_INVALID", parsed);

    // Replay rows in date order against positions/cash — all or nothing.
    const rows = [...parsed].sort((a, b) => a.date.getTime() - b.date.getTime());
    const positions = new Map<string, { qty: number; cost: number }>();
    let cash = portfolio.cash;
    for (const r of rows) {
      if (r.side === "BUY") {
        const p = positions.get(r.symbol) ?? { qty: 0, cost: 0 };
        positions.set(r.symbol, { qty: p.qty + r.quantity, cost: (p.cost * p.qty + r.price * r.quantity) / (p.qty + r.quantity) });
        cash -= r.quantity * r.price + r.fees;
      } else if (r.side === "SELL") {
        const p = positions.get(r.symbol);
        if (!p || p.qty < r.quantity) return fail(400, "CSV_INVALID", `Row for ${r.symbol}: sell exceeds imported position`);
        p.qty -= r.quantity;
        cash += r.quantity * r.price - r.fees;
      } else if (r.side === "DEPOSIT") cash += r.quantity;
      else cash -= r.quantity;
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.createMany({
        data: rows.map((r) => ({ portfolioId: id, symbol: r.symbol, side: r.side, quantity: r.quantity, price: r.price, fees: r.fees, executedAt: r.date, note: r.note })),
      });
      for (const [symbol, p] of positions) {
        if (p.qty <= 1e-9) continue;
        const existing = await tx.position.findFirst({ where: { portfolioId: id, symbol, optionType: null } });
        if (existing) {
          const qty = existing.quantity + p.qty;
          await tx.position.update({ where: { id: existing.id }, data: { quantity: qty, avgCost: (existing.avgCost * existing.quantity + p.cost * p.qty) / qty } });
        } else {
          await tx.position.create({ data: { portfolioId: id, symbol, assetClass: "STOCK", quantity: p.qty, avgCost: p.cost } });
        }
      }
      await tx.portfolio.update({ where: { id }, data: { cash } });
    });
    return ok({ imported: rows.length, cash }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
