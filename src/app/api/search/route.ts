import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery } from "@/lib/api";

const schema = z.object({
  q: z.string().min(1).max(40),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    const results = await facade.search(parsed.q);
    return ok(Array.isArray(results) ? results.slice(0, parsed.limit) : results);
  } catch (err) {
    return handleError(err);
  }
}
