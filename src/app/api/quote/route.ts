import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery, symbolSchema } from "@/lib/api";

const schema = z.object({
  symbols: z.string().min(1).max(400),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    const symbols = parsed.symbols.split(",").map((s) => symbolSchema.parse(s.trim())).slice(0, 60);
    const quotes = await facade.getQuotes(symbols);
    return ok(quotes);
  } catch (err) {
    return handleError(err);
  }
}
