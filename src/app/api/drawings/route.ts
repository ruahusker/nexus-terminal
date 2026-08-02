// Chart drawings — per user, per symbol. Points are time/price anchors so
// drawings survive timeframe changes, pan, and zoom.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody, symbolSchema } from "@/lib/api";

export const dynamic = "force-dynamic";

const pointSchema = z.object({
  time: z.number().int().positive(),
  price: z.number().finite(),
});

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const symbol = new URL(req.url).searchParams.get("symbol");
    const drawings = await prisma.drawing.findMany({
      where: { userId: user.id, ...(symbol ? { symbol: symbol.toUpperCase() } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return ok(drawings.map((d) => ({ ...d, points: JSON.parse(d.points) })));
  } catch (err) {
    return handleError(err);
  }
}

const postSchema = z.object({
  symbol: symbolSchema,
  tool: z.enum(["TRENDLINE", "RAY", "HLINE", "RECT", "FIB"]),
  points: z.array(pointSchema).min(1).max(4),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, postSchema);
    if (parsed instanceof Response) return parsed;
    const count = await prisma.drawing.count({ where: { userId: user.id, symbol: parsed.symbol } });
    if (count >= 100) return fail(400, "LIMIT", "Maximum 100 drawings per symbol");
    const drawing = await prisma.drawing.create({
      data: {
        userId: user.id,
        symbol: parsed.symbol,
        tool: parsed.tool,
        points: JSON.stringify(parsed.points),
        color: parsed.color ?? null,
      },
    });
    return ok({ ...drawing, points: parsed.points }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

const deleteSchema = z.object({
  id: z.string().min(1).optional(),
  symbol: symbolSchema.optional(), // delete ALL drawings for a symbol
});

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, deleteSchema);
    if (parsed instanceof Response) return parsed;
    if (!parsed.id && !parsed.symbol) return fail(400, "VALIDATION", "id or symbol required");
    const result = await prisma.drawing.deleteMany({
      where: { userId: user.id, ...(parsed.id ? { id: parsed.id } : { symbol: parsed.symbol }) },
    });
    return ok({ deleted: result.count });
  } catch (err) {
    return handleError(err);
  }
}
