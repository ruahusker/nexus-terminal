// Record a transaction and apply it to positions + cash atomically.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody, symbolSchema } from "@/lib/api";
import { facade } from "@/lib/providers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const txSchema = z.object({
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL", "DEPOSIT", "WITHDRAWAL"]),
  quantity: z.coerce.number().positive().max(1e9),
  price: z.coerce.number().min(0).max(1e9),
  fees: z.coerce.number().min(0).max(1e6).default(0),
  executedAt: z.string().datetime().optional(),
  note: z.string().max(200).optional(),
  assetClass: z.enum(["STOCK", "ETF", "CRYPTO", "OPTION"]).default("STOCK"),
  optionType: z.enum(["CALL", "PUT"]).optional(),
  strike: z.coerce.number().positive().optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = await parseBody(req, txSchema);
    if (parsed instanceof Response) return parsed;
    const portfolio = await prisma.portfolio.findFirst({ where: { id, userId: user.id } });
    if (!portfolio) return fail(404, "NOT_FOUND", "Portfolio not found");

    const { side, quantity, price, fees } = parsed;
    const cashDelta =
      side === "BUY" ? -(quantity * price + fees)
      : side === "SELL" ? quantity * price - fees
      : side === "DEPOSIT" ? quantity
      : -quantity; // WITHDRAWAL

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          portfolioId: id, symbol: parsed.symbol, side, quantity, price, fees,
          executedAt: parsed.executedAt ? new Date(parsed.executedAt) : new Date(),
          note: parsed.note ?? null,
        },
      });
      let position = null;
      if (side === "BUY" || side === "SELL") {
        const existing = await tx.position.findFirst({
          where: {
            portfolioId: id, symbol: parsed.symbol,
            optionType: parsed.optionType ?? null,
            strike: parsed.strike ?? null,
            expiry: parsed.expiry ?? null,
          },
        });
        if (side === "BUY") {
          if (existing) {
            const newQty = existing.quantity + quantity;
            position = await tx.position.update({
              where: { id: existing.id },
              data: { quantity: newQty, avgCost: (existing.avgCost * existing.quantity + price * quantity) / newQty },
            });
          } else {
            position = await tx.position.create({
              data: {
                portfolioId: id, symbol: parsed.symbol, assetClass: parsed.assetClass,
                quantity, avgCost: price,
                optionType: parsed.optionType ?? null, strike: parsed.strike ?? null, expiry: parsed.expiry ?? null,
              },
            });
          }
        } else {
          if (!existing) throw Object.assign(new Error(`No open position in ${parsed.symbol} to sell`), { code: "NO_POSITION" });
          const newQty = existing.quantity - quantity;
          if (newQty < -1e-9) throw Object.assign(new Error(`Sell quantity exceeds position (${existing.quantity})`), { code: "OVERSOLD" });
          position = newQty <= 1e-9
            ? await tx.position.delete({ where: { id: existing.id } }).then(() => null)
            : await tx.position.update({ where: { id: existing.id }, data: { quantity: newQty } });
        }
      }
      const updated = await tx.portfolio.update({ where: { id }, data: { cash: { increment: cashDelta } } });
      return { txn, position, cash: updated.cash };
    });
    return ok(result, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "NO_POSITION" || code === "OVERSOLD") return fail(400, code, (err as Error).message);
    return handleError(err);
  }
}
