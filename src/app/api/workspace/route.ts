import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const ws = await prisma.workspace.findFirst({ where: { userId: user.id } });
    return ok(ws ? JSON.parse(ws.layout) : null);
  } catch (err) {
    return handleError(err);
  }
}

const putSchema = z.object({
  layout: z.string().min(2).max(100_000),
});

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, putSchema);
    if (parsed instanceof Response) return parsed;
    JSON.parse(parsed.layout); // validate it's real JSON before storing
    const ws = await prisma.workspace.upsert({
      where: { userId: user.id },
      create: { userId: user.id, layout: parsed.layout },
      update: { layout: parsed.layout },
    });
    return ok({ updatedAt: ws.updatedAt });
  } catch (err) {
    return handleError(err);
  }
}
