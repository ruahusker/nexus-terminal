import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery } from "@/lib/api";

const schema = z.object({
  days: z.coerce.number().int().min(1).max(31).default(7),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    return ok(await facade.getEarningsCalendar(parsed.days));
  } catch (err) {
    return handleError(err);
  }
}
