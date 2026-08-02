// ─── Agent loop ─────────────────────────────────────────────────────────────
// Kimi decides which terminal data tools to call; results feed back until it
// composes a final answer. Hard-capped rounds; every call lands in the trace.

import { chat, type ChatMessage } from "./kimi";
import { executeTool, TOOLS } from "./tools";

const SYSTEM = `You are the NEXUS terminal's data assistant — a Bloomberg-style financial terminal.
Rules:
- NEVER invent numbers. Every figure must come from a tool call in this conversation.
- Use tools aggressively: screen with get_screener, then drill into candidates with get_quotes / get_bars / get_fundamentals.
- Batch independent tool calls into the SAME turn (e.g. bars for several candidates at once) — each extra round costs ~30 seconds.
- For technical questions (moving averages, pullbacks, volatility), fetch get_bars and compute from the closes.
- When you state a price or level, note the timestamp (asOf) if the tool provided one.
- Be concise: short paragraphs, small tables or bullet lists, markdown-lite. Lead with the answer.
- If a terminal screen would help, end with the relevant command, e.g. DES AAPL · CHART BTC · OPTIONS NVDA · MARKETS.`;

const MAX_ROUNDS = 6;
const MAX_TOOL_PAYLOAD = 24_000;

export interface TraceEntry {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface AgentResult {
  answer: string;
  trace: TraceEntry[];
}

export async function ask(
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: "user", content: question },
  ];
  const trace: TraceEntry[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await chat(messages, TOOLS);
    if (!msg.tool_calls?.length) {
      return { answer: msg.content?.trim() || "(empty answer from model)", trace };
    }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      let ok = true;
      let result: unknown;
      try {
        result = await executeTool(tc.function.name, args);
      } catch (err) {
        ok = false;
        result = { error: err instanceof Error ? err.message : "tool failed" };
      }
      trace.push({ tool: tc.function.name, args, ok });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, MAX_TOOL_PAYLOAD),
      });
    }
  }
  return { answer: "I ran out of tool-call rounds before finishing — try a narrower question.", trace };
}
