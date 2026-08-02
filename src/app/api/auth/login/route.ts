import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { fail, handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1).max(40).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const parsed = await parseBody(req, schema);
    if (parsed instanceof Response) return parsed;
    const user = await prisma.user.findUnique({ where: { username: parsed.username } });
    // Constant-shape failure: don't reveal which part was wrong
    if (!user || !(await verifyPassword(parsed.password, user.passwordHash))) {
      return fail(401, "BAD_CREDENTIALS", "Invalid username or password");
    }
    const { token, expiresAt } = await createSession(user.id);
    const res = ok({ id: user.id, username: user.username, name: user.name });
    res.cookies.set({ ...sessionCookieOptions(expiresAt), value: token });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
