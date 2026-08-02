import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery, symbolSchema } from "@/lib/api";

const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);

const schema = z.object({
  symbol: z.preprocess(emptyToUndef, symbolSchema.optional()),
  topic: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  q: z.preprocess(emptyToUndef, z.string().max(80).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    return ok(await facade.getNews(parsed));
  } catch (err) {
    return handleError(err);
  }
}
