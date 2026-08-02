import { z } from "zod";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseQuery } from "@/lib/api";

const schema = z.object({
  view: z.enum(["calendar", "series", "list"]).default("list"),
  id: z.string().max(30).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const parsed = parseQuery(req, schema);
    if (parsed instanceof Response) return parsed;
    if (parsed.view === "calendar") return ok(await facade.getEconCalendar());
    if (parsed.view === "list") return ok(await facade.listEconSeries());
    if (!parsed.id) return fail(400, "VALIDATION", "id is required for view=series");
    const series = await facade.getEconSeries(parsed.id);
    if (!series) return fail(404, "NOT_FOUND", `Unknown series: ${parsed.id}`);
    return ok(series);
  } catch (err) {
    return handleError(err);
  }
}
