import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody, symbolSchema } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const lists = await prisma.watchlist.findMany({ where: { userId: user.id }, include: { items: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "asc" } });
    return ok(lists);
  } catch (err) {
    return handleError(err);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createList"), name: z.string().min(1).max(60) }),
  z.object({ action: z.literal("deleteList"), listId: z.string().min(1) }),
  z.object({ action: z.literal("add"), listId: z.string().min(1), symbol: symbolSchema }),
  z.object({ action: z.literal("remove"), listId: z.string().min(1), symbol: symbolSchema }),
]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, postSchema);
    if (parsed instanceof Response) return parsed;
    switch (parsed.action) {
      case "createList":
        return ok(await prisma.watchlist.create({ data: { userId: user.id, name: parsed.name }, include: { items: true } }), { status: 201 });
      case "deleteList": {
        const list = await prisma.watchlist.findFirst({ where: { id: parsed.listId, userId: user.id } });
        if (!list) return fail(404, "NOT_FOUND", "Watchlist not found");
        await prisma.watchlist.delete({ where: { id: parsed.listId } });
        return ok({ deleted: parsed.listId });
      }
      case "add": {
        const list = await prisma.watchlist.findFirst({ where: { id: parsed.listId, userId: user.id } });
        if (!list) return fail(404, "NOT_FOUND", "Watchlist not found");
        const count = await prisma.watchlistItem.count({ where: { watchlistId: parsed.listId } });
        const item = await prisma.watchlistItem.upsert({
          where: { watchlistId_symbol: { watchlistId: parsed.listId, symbol: parsed.symbol } },
          create: { watchlistId: parsed.listId, symbol: parsed.symbol, position: count },
          update: {},
        });
        return ok(item, { status: 201 });
      }
      case "remove": {
        const list = await prisma.watchlist.findFirst({ where: { id: parsed.listId, userId: user.id } });
        if (!list) return fail(404, "NOT_FOUND", "Watchlist not found");
        await prisma.watchlistItem.deleteMany({ where: { watchlistId: parsed.listId, symbol: parsed.symbol } });
        return ok({ removed: parsed.symbol });
      }
    }
  } catch (err) {
    return handleError(err);
  }
}
