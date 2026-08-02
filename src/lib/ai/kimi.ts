// ─── Kimi chat-completions client ───────────────────────────────────────────
// Minimal OpenAI-compatible client (no SDK dependency). The key comes from
// KIMI_API_KEY — the kimi CLI's own credential is OAuth-scoped and does NOT
// work for direct API calls; get a platform key at platform.moonshot.cn.

import { ProviderError } from "../providers/errors";

const BASE_URL = process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1";
const MODEL = process.env.KIMI_MODEL ?? "kimi-k2-0905-preview";
// Tool-picking rounds don't benefit from deep reasoning; "low" cuts latency a lot.
const REASONING = process.env.KIMI_REASONING ?? "low";

export function isConfigured(): boolean {
  return Boolean(process.env.KIMI_API_KEY);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface Completion {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  error?: { message?: string };
}

export async function chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatMessage> {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new ProviderError("KIMI_API_KEY not set — add a Moonshot platform key to .env", "config");
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages, tools, reasoning_effort: REASONING }),
      signal: AbortSignal.timeout(300_000), // reasoning completions can run minutes
    });
  } catch (err) {
    throw new ProviderError(`Kimi network error: ${String(err)}`, "upstream");
  }
  if (res.status === 401) throw new ProviderError("Kimi auth rejected — check KIMI_API_KEY", "config");
  if (res.status === 429) throw new ProviderError("Kimi rate limit — try again shortly", "rate_limit");
  if (!res.ok) throw new ProviderError(`Kimi HTTP ${res.status}`, "upstream");
  const json = (await res.json()) as Completion;
  if (json.error) throw new ProviderError(`Kimi: ${json.error.message ?? "error"}`, "upstream");
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new ProviderError("Kimi: empty completion", "upstream");
  return msg;
}
