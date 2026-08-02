import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody, symbolSchema } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const alerts = await prisma.alert.findMany({
      where: { userId: user.id },
      include: { events: { orderBy: { triggeredAt: "desc" }, take: 20 } },
      orderBy: { createdAt: "desc" },
    });
    return ok(alerts);
  } catch (err) {
    return handleError(err);
  }
}

const ALERT_KINDS = ["PRICE_ABOVE", "PRICE_BELOW", "PCT_MOVE", "VOLUME_SPIKE", "IV_CHANGE", "EARNINGS", "DIVIDEND", "NEWS"] as const;

const postSchema = z.object({
  symbol: symbolSchema,
  kind: z.enum(ALERT_KINDS),
  threshold: z.coerce.number().positive().optional(),
  note: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, postSchema);
    if (parsed instanceof Response) return parsed;
    if (["PRICE_ABOVE", "PRICE_BELOW", "PCT_MOVE", "VOLUME_SPIKE", "IV_CHANGE"].includes(parsed.kind) && parsed.threshold == null) {
      return fail(400, "VALIDATION", `threshold is required for ${parsed.kind}`);
    }
    const alert = await prisma.alert.create({
      data: { userId: user.id, symbol: parsed.symbol, kind: parsed.kind, threshold: parsed.threshold ?? null, note: parsed.note ?? null },
    });
    return ok(alert, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  active: z.boolean().optional(),
  delete: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, patchSchema);
    if (parsed instanceof Response) return parsed;
    const existing = await prisma.alert.findFirst({ where: { id: parsed.id, userId: user.id } });
    if (!existing) return fail(404, "NOT_FOUND", "Alert not found");
    if (parsed.delete) {
      await prisma.alert.delete({ where: { id: parsed.id } });
      return ok({ deleted: parsed.id });
    }
    const alert = await prisma.alert.update({ where: { id: parsed.id }, data: { active: parsed.active } });
    return ok(alert);
  } catch (err) {
    return handleError(err);
  }
}
