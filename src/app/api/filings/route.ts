import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery, symbolSchema } from "@/lib/api";

const schema = z.object({ symbol: symbolSchema });

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    return ok(await facade.getFilings(parsed.symbol));
  } catch (err) {
    return handleError(err);
  }
}
