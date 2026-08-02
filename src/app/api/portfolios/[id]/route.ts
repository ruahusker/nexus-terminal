import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  cash: z.coerce.number().min(0).max(1e12).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = await parseBody(req, patchSchema);
    if (parsed instanceof Response) return parsed;
    const existing = await prisma.portfolio.findFirst({ where: { id, userId: user.id } });
    if (!existing) return fail(404, "NOT_FOUND", "Portfolio not found");
    const portfolio = await prisma.portfolio.update({ where: { id }, data: parsed });
    return ok(portfolio);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const existing = await prisma.portfolio.findFirst({ where: { id, userId: user.id } });
    if (!existing) return fail(404, "NOT_FOUND", "Portfolio not found");
    const count = await prisma.portfolio.count({ where: { userId: user.id } });
    if (count <= 1) return fail(400, "LAST_PORTFOLIO", "At least one portfolio must exist");
    await prisma.portfolio.delete({ where: { id } });
    return ok({ deleted: id });
  } catch (err) {
    return handleError(err);
  }
}
