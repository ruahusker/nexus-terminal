import { z } from "zod";
import { facade, dataMode } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseQuery, symbolSchema } from "@/lib/api";
import { lookup } from "@/lib/demo/universe";
import { massive } from "@/lib/providers/massive";
import type { DataStatus } from "@/lib/types";

const schema = z.object({
  symbol: symbolSchema,
  interval: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]).default("1d"),
  range: z.enum(["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "5Y", "MAX"]).default("1Y"),
});

export const dynamic = "force-dynamic";

function provenance(symbol: string): { provider: string; status: DataStatus } {
  if (dataMode() === "demo") return { provider: "demo", status: "SAMPLE" };
  const u = lookup(symbol);
  if (!u) return { provider: "demo", status: "SAMPLE" };
  if (u.assetClass === "STOCK" || u.assetClass === "ETF") {
    return massive.isConfigured() ? { provider: "massive", status: "DELAYED" } : { provider: "demo", status: "SAMPLE" };
  }
  if (u.assetClass === "CRYPTO") return { provider: "coinbase", status: "REALTIME" };
  return { provider: "yahoo", status: "DELAYED" };
}

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    const bars = await facade.getBars(parsed.symbol, parsed.interval, parsed.range);
    return ok({ bars, ...provenance(parsed.symbol), asOf: new Date().toISOString() });
  } catch (err) {
    return handleError(err);
  }
}
