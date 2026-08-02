import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return ok(await facade.getMarketOverview());
  } catch (err) {
    return handleError(err);
  }
}
