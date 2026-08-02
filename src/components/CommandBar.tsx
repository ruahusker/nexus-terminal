"use client";

// Persistent terminal command bar: symbol lookup + commands, autocomplete
// grouped by asset class, history with ↑/↓, Enter to execute, Esc to clear.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTerminal } from "./TerminalContext";
import { COMMANDS } from "@/lib/commands";
import { api } from "@/lib/client";
import type { AssetClass, InstrumentInfo } from "@/lib/types";

const HISTORY_KEY = "nexus-cmd-history";
const MAX_HISTORY = 50;

interface SearchGroup {
  assetClass: AssetClass;
  items: InstrumentInfo[];
}

const CLASS_ORDER: AssetClass[] = ["STOCK", "ETF", "INDEX", "FX", "CRYPTO", "FUTURE", "BOND"];
const CLASS_LABEL: Record<AssetClass, string> = {
  STOCK: "Stocks", ETF: "ETFs", INDEX: "Indexes", FX: "FX", CRYPTO: "Crypto", FUTURE: "Commodities", BOND: "Bonds",
};

type Suggestion =
  | { kind: "command"; verb: string; usage: string; description: string }
  | { kind: "instrument"; info: InstrumentInfo };

export function CommandBar() {
  const { execute, commandBarOpen, setCommandBarOpen } = useTerminal();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<InstrumentInfo[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<"demo" | "provider" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ mode: "demo" | "provider" }>("/api/mode")
      .then((r) => setMode(r.mode))
      .catch(() => {});
  }, []);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (commandBarOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [commandBarOpen]);

  // Debounced symbol search
  useEffect(() => {
    const q = input.trim();
    const firstWord = q.split(/\s+/)[0] ?? "";
    const isCommand = COMMANDS.some((c) => c.verb === firstWord.toUpperCase() || c.aliases.includes(firstWord.toUpperCase()));
    if (q.length === 0 || (isCommand && q.includes(" "))) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const term = isCommand ? (q.split(/\s+/)[1] ?? "") : q;
      if (term.length === 0) {
        setResults([]);
        return;
      }
      api<InstrumentInfo[]>(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          setResults(r);
          setSelIdx(0);
        })
        .catch(() => setResults([]));
    }, 120);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = input.trim().toUpperCase();
    const out: Suggestion[] = [];
    if (q.length > 0 && !q.includes(" ")) {
      for (const c of COMMANDS) {
        if (c.verb.startsWith(q) || c.aliases.some((a) => a.startsWith(q))) {
          out.push({ kind: "command", verb: c.verb, usage: c.usage, description: c.description });
        }
      }
    }
    for (const info of results) out.push({ kind: "instrument", info });
    return out.slice(0, 12);
  }, [input, results]);

  const pushHistory = useCallback((cmd: string) => {
    setHistory((h) => {
      const next = [cmd, ...h.filter((x) => x !== cmd)].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const run = useCallback(
    (cmd: string) => {
      const err = execute(cmd);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      pushHistory(cmd.trim());
      setInput("");
      setResults([]);
      setHistIdx(null);
      inputRef.current?.blur();
      setCommandBarOpen(false);
    },
    [execute, pushHistory, setCommandBarOpen],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (input) {
        setInput("");
        setError(null);
        setResults([]);
      } else {
        (e.target as HTMLInputElement).blur();
        setCommandBarOpen(false);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = suggestions[selIdx];
      if (sel && suggestions.length > 0) {
        if (sel.kind === "command") {
          const needsSymbol = COMMANDS.find((c) => c.verb === sel.verb)?.takesSymbol ?? false;
          if (needsSymbol) {
            setInput(`${sel.verb} `);
            setResults([]);
          } else {
            run(sel.verb);
          }
        } else {
          run(sel.info.symbol);
        }
      } else if (input.trim()) {
        run(input);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (history.length > 0) {
        const next = histIdx == null ? 0 : Math.min(histIdx + 1, history.length - 1);
        setHistIdx(next);
        setInput(history[next] ?? "");
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelIdx((i) => Math.max(i - 1, 0));
      } else if (history.length > 0) {
        if (histIdx == null) {
          setHistIdx(0);
          setInput(history[0] ?? "");
        } else if (histIdx > 0) {
          setHistIdx(histIdx - 1);
          setInput(history[histIdx - 1] ?? "");
        } else {
          setHistIdx(null);
          setInput("");
        }
      }
    }
  };

  // group instrument suggestions by asset class
  const grouped = useMemo<SearchGroup[]>(() => {
    const byClass = new Map<AssetClass, InstrumentInfo[]>();
    for (const s of suggestions) {
      if (s.kind !== "instrument") continue;
      const list = byClass.get(s.info.assetClass) ?? [];
      list.push(s.info);
      byClass.set(s.info.assetClass, list);
    }
    return CLASS_ORDER.filter((c) => byClass.has(c)).map((c) => ({ assetClass: c, items: byClass.get(c) ?? [] }));
  }, [suggestions]);

  const commandSuggestions = suggestions.filter((s): s is Extract<Suggestion, { kind: "command" }> => s.kind === "command");

  // flat index for highlight
  let flatIdx = -1;
  const nextFlat = () => ++flatIdx;

  return (
    <div className="relative border-b border-nx-border-strong bg-nx-panel" role="search">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="select-none text-[11px] font-bold tracking-wider text-nx-amber" aria-hidden>
          NEXUS▸
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
            setHistIdx(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setCommandBarOpen(true)}
          placeholder="Enter command or symbol — AAPL · QUOTE MSFT · OPTIONS NVDA · MARKETS · HELP  ( ` to focus )"
          aria-label="Terminal command bar"
          aria-expanded={suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls="cmd-suggestions"
          role="combobox"
          spellCheck={false}
          autoComplete="off"
          className="h-6 flex-1 bg-transparent text-[12px] text-nx-text-bright placeholder:text-nx-faint focus:outline-none"
        />
        {error && (
          <span className="text-[10px] text-nx-down" role="alert">
            {error}
          </span>
        )}
        {mode === "demo" && (
          <span className="hidden select-none text-[10px] text-nx-faint sm:inline">DEMO MODE</span>
        )}
      </div>

      {(suggestions.length > 0 || (histIdx != null && history.length > 0)) && (
        <div
          id="cmd-suggestions"
          role="listbox"
          aria-label="Suggestions"
          className="absolute left-0 right-0 top-full z-50 max-h-80 overflow-auto border border-nx-border-strong bg-nx-panel shadow-lg shadow-black/60"
        >
          {commandSuggestions.length > 0 && (
            <div>
              <div className="px-2 pt-1 text-[9px] uppercase tracking-widest text-nx-faint">Commands</div>
              {commandSuggestions.map((s) => {
                const i = nextFlat();
                return (
                  <button
                    key={s.verb}
                    role="option"
                    aria-selected={i === selIdx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInput(s.usage.includes("SYM") ? `${s.verb} ` : s.verb);
                      if (!s.usage.includes("SYM")) run(s.verb);
                    }}
                    className={`flex w-full items-baseline gap-3 px-2 py-1 text-left text-[11px] ${i === selIdx ? "bg-nx-amber/10 text-nx-amber" : "text-nx-text"}`}
                  >
                    <span className="w-28 shrink-0 font-semibold">{s.usage}</span>
                    <span className="text-nx-muted">{s.description}</span>
                  </button>
                );
              })}
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.assetClass}>
              <div className="px-2 pt-1 text-[9px] uppercase tracking-widest text-nx-faint">{CLASS_LABEL[g.assetClass]}</div>
              {g.items.map((info) => {
                const i = nextFlat();
                return (
                  <button
                    key={info.symbol}
                    role="option"
                    aria-selected={i === selIdx}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      run(info.symbol);
                    }}
                    className={`flex w-full items-baseline gap-3 px-2 py-1 text-left text-[11px] ${i === selIdx ? "bg-nx-amber/10" : ""}`}
                  >
                    <span className="w-16 shrink-0 font-semibold text-nx-amber">{info.symbol}</span>
                    <span className="flex-1 truncate text-nx-text">{info.name}</span>
                    <span className="text-[10px] text-nx-muted">{info.exchange}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
