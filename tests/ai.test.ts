// Tests for the Kimi agent loop — the LLM API is mocked; tool executors run
// against the real facade in demo mode (deterministic, offline).

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KIMI_API_KEY = "test-key";

const { ask } = await import("@/lib/ai/agent");
const { ProviderError } = await import("@/lib/providers/errors");

let fetchMock: ReturnType<typeof vi.fn>;

function completion(msg: object): Response {
  return new Response(JSON.stringify({ choices: [{ message: msg }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function toolCall(name: string, args: object, id = "call-1") {
  return completion({
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
}

const finalAnswer = (text: string) => completion({ role: "assistant", content: text });

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
  process.env.KIMI_API_KEY = "test-key";
});

describe("agent loop", () => {
  it("runs a tool call and returns the final answer with a trace", async () => {
    fetchMock
      .mockResolvedValueOnce(toolCall("get_screener", {}))
      .mockResolvedValueOnce(finalAnswer("AAPL and MSFT have the highest PE."));
    const r = await ask("which stocks have the highest PE?", []);
    expect(r.answer).toContain("AAPL");
    expect(r.trace).toEqual([{ tool: "get_screener", args: {}, ok: true }]);
    // second call includes the tool result message
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as { messages: { role: string; content: string }[] };
    const toolMsg = secondBody.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("AAPL");
  });

  it("answers directly when the model makes no tool call", async () => {
    fetchMock.mockResolvedValueOnce(finalAnswer("Hello!"));
    const r = await ask("hi", []);
    expect(r.answer).toBe("Hello!");
    expect(r.trace.length).toBe(0);
  });

  it("surfaces tool errors to the model instead of crashing", async () => {
    fetchMock
      .mockResolvedValueOnce(toolCall("get_bars", { symbol: "NOPE", interval: "1d", range: "1Y" }))
      .mockResolvedValueOnce(finalAnswer("I could not get bars for NOPE."));
    const r = await ask("bars for NOPE?", []);
    expect(r.trace[0]?.ok).toBe(false);
    expect(r.answer).toContain("could not");
  });

  it("stops after the max rounds", async () => {
    for (let i = 0; i < 6; i++) fetchMock.mockResolvedValueOnce(toolCall("get_quotes", { symbols: ["AAPL"] }, `call-${i}`));
    const r = await ask("loop forever", []);
    expect(r.answer).toContain("ran out of tool-call rounds");
    expect(r.trace.length).toBe(6);
  });

  it("throws a config error when KIMI_API_KEY is missing", async () => {
    delete process.env.KIMI_API_KEY;
    await expect(ask("anything", [])).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
