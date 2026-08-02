import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, hashPassword, provisionNewUser, registrationOpen, sessionCookieOptions } from "@/lib/auth";
import { fail, handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dots, dashes, underscores only")
    .transform((s) => s.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  try {
    if (!registrationOpen()) {
      const count = await prisma.user.count();
      if (count > 0) return fail(403, "REGISTRATION_CLOSED", "Registration is closed on this server");
    }
    const parsed = await parseBody(req, schema);
    if (parsed instanceof Response) return parsed;
    const existing = await prisma.user.findUnique({ where: { username: parsed.username } });
    if (existing) return fail(409, "USERNAME_TAKEN", "That username is already taken");

    const user = await prisma.user.create({
      data: { username: parsed.username, name: parsed.name ?? null, passwordHash: await hashPassword(parsed.password) },
    });
    await provisionNewUser(user.id);
    const { token, expiresAt } = await createSession(user.id);
    const res = ok({ id: user.id, username: user.username }, { status: 201 });
    res.cookies.set({ ...sessionCookieOptions(expiresAt), value: token });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
