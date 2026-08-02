import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

// Full row set (bounded universe, ~110 rows) — filtering/sorting happens
// client-side so saved screens are pure JSON criteria with instant updates.
export async function GET() {
  try {
    await requireUser();
    return ok(await facade.getScreenerRows());
  } catch (err) {
    return handleError(err);
  }
}
