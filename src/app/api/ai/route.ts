import { z } from "zod";
import { ask } from "@/lib/ai/agent";
import { isConfigured, modelName } from "@/lib/ai/kimi";
import { requireUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

const schema = z.object({
  question: z.string().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(10)
    .default([]),
});

export const dynamic = "force-dynamic";

/** Whether the Kimi backend is configured (lets the screen show setup help). */
export async function GET() {
  try {
    await requireUser();
    return ok({ configured: isConfigured(), model: modelName() });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireUser();
    if (!isConfigured()) {
      return ok({
        answer:
          "The AI assistant needs a Kimi API key. Add `KIMI_API_KEY` to the server `.env` " +
          "(platform key from platform.moonshot.cn — the kimi CLI's own credential does not work " +
          "for direct API calls), then restart the server.",
        trace: [],
      });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return ok({ answer: `Invalid request: ${parsed.error.issues[0]?.message ?? "bad input"}`, trace: [] });
    }
    const result = await ask(parsed.data.question, parsed.data.history);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
