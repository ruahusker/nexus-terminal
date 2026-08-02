import { getSessionUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    return ok({ user, registrationNote: null });
  } catch (err) {
    return handleError(err);
  }
}
