import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery, symbolSchema } from "@/lib/api";
import { ProviderError } from "@/lib/providers/errors";

const schema = z.object({
  symbol: symbolSchema,
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    const inst = await facade.resolveInstrument(parsed.symbol);
    if (!inst) return handleError(new Error(`Unknown symbol: ${parsed.symbol}`));
    if (!inst.optionable) {
      return ok({ noOptions: true, symbol: parsed.symbol, message: `${parsed.symbol} has no listed options in this universe.` });
    }
    try {
      return ok(await facade.getOptionsChain(parsed.symbol, parsed.expiry));
    } catch (err) {
      // Symbol exists but has no listed options (or provider can't serve them)
      if (err instanceof ProviderError && (err.kind === "not_found" || err.kind === "upstream")) {
        return ok({ noOptions: true, symbol: parsed.symbol, message: `No options chain available for ${parsed.symbol} from the configured provider.` });
      }
      throw err;
    }
  } catch (err) {
    return handleError(err);
  }
}
