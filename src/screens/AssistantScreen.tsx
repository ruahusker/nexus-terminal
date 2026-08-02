"use client";

// AI — natural-language assistant backed by Kimi. Questions are answered by an
// agent loop that calls the terminal's own data tools (quotes, bars, screener,
// fundamentals, options, news) and shows its tool trace under each answer.

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { EmptyState, SectionTitle } from "@/components/ui";

interface TraceEntry {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  trace?: TraceEntry[];
}

const SUGGESTIONS = [
  "Stocks with a high PE that pulled back 15%+ from their 52-week high",
  "How far is bitcoin from its 200-day moving average?",
  "What's the market doing today?",
  "Expected move for NVDA into next expiry",
];

/** Minimal markdown-lite: **bold**, - bullets, line breaks. */
function renderAnswer(text: string) {
  const bold = (s: string, k: number) => {
    const parts = s.split(/\*\*(.+?)\*\*/g);
    return parts.map((p, i) =>
      i % 2 === 1 ? <strong key={`${k}-${i}`} className="text-nx-text-bright">{p}</strong> : p,
    );
  };
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (/^[-•*]\s+/.test(trimmed)) {
      return (
        <div key={i} className="flex gap-1.5">
          <span className="text-nx-amber">▪</span>
          <span>{bold(trimmed.replace(/^[-•*]\s+/, ""), i)}</span>
        </div>
      );
    }
    if (trimmed === "") return <div key={i} className="h-2" />;
    return <div key={i}>{bold(line, i)}</div>;
  });
}

export default function AssistantScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ configured: boolean }>("/api/ai")
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    try {
      const r = await api<{ answer: string; trace: TraceEntry[] }>("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          history: next.slice(-11, -1).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setMessages([...next, { role: "assistant", content: r.answer, trace: r.trace }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `⚠ ${err instanceof Error ? err.message : "Request failed"}` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="AI assistant">
      <div className="flex items-center justify-between border-b border-nx-border px-2 py-0.5 text-[10px] text-nx-muted">
        <SectionTitle>AI Assistant</SectionTitle>
        <span className="text-nx-faint">{configured === null ? "…" : configured ? "kimi · tools: terminal data" : "not configured"}</span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-2">
        {messages.length === 0 && (
          <>
            <EmptyState
              message="Ask anything about the market — I pull the data for you"
              hint="I query quotes, bars, screeners, fundamentals, options and news via the terminal, then answer with numbers"
            />
            <div className="mt-2 space-y-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="block w-full border border-nx-border bg-nx-panel px-2 py-1 text-left text-[11px] text-nx-muted hover:border-nx-amber hover:text-nx-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
            <div
              className={`inline-block max-w-[92%] px-2 py-1 text-left text-[12px] leading-relaxed ${
                m.role === "user"
                  ? "border border-nx-amber/40 bg-nx-amber/10 text-nx-text-bright"
                  : "border border-nx-border bg-nx-panel text-nx-text"
              }`}
            >
              {m.role === "user" ? m.content : renderAnswer(m.content)}
              {m.trace && m.trace.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-nx-border pt-1">
                  {m.trace.map((t, j) => (
                    <span
                      key={j}
                      title={JSON.stringify(t.args)}
                      className={`border px-1 py-px text-[9px] ${t.ok ? "border-nx-border text-nx-faint" : "border-nx-down/50 text-nx-down"}`}
                    >
                      {t.tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-nx-muted">
            <span className="inline-block h-3 w-3 animate-spin border border-nx-border-strong border-t-nx-amber" aria-hidden />
            Querying terminal data…
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-nx-border px-2 py-1.5">
        <span className="select-none text-[11px] font-bold text-nx-amber" aria-hidden>AI▸</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(input);
          }}
          placeholder="Ask a question — e.g. how far is BTC from its 200-day MA?"
          aria-label="Ask the AI assistant"
          disabled={busy}
          className="h-6 flex-1 bg-transparent text-[12px] text-nx-text-bright placeholder:text-nx-faint focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
