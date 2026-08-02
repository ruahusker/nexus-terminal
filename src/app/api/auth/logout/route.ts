import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE_NAME)?.value;
    if (token) await destroySession(token);
    const res = ok({ loggedOut: true });
    res.cookies.set({ name: SESSION_COOKIE_NAME, value: "", path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
