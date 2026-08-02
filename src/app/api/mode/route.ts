import { dataMode } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

// Exposes the server-side data mode so client chrome (e.g. the command-bar
// badge) can reflect whether data is demo or real.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return ok({ mode: dataMode() });
  } catch (err) {
    return handleError(err);
  }
}
