import { z } from "zod";
import { getArticle } from "@/lib/article";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery } from "@/lib/api";

const schema = z.object({
  url: z.string().url().max(1000),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    return ok(await getArticle(parsed.url));
  } catch (err) {
    return handleError(err);
  }
}
