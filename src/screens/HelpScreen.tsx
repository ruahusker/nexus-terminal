"use client";

// HELP — searchable command reference and keyboard shortcuts.

import { useMemo, useState } from "react";
import { COMMANDS, SHORTCUTS } from "@/lib/commands";
import { useTerminal } from "@/components/TerminalContext";
import { SectionTitle } from "@/components/ui";

export default function HelpScreen() {
  const [q, setQ] = useState("");
  const { execute } = useTerminal();

  const commands = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.verb.includes(needle) || c.description.toUpperCase().includes(needle) || c.aliases.some((a) => a.includes(needle)),
    );
  }, [q]);

  const shortcuts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return SHORTCUTS;
    return SHORTCUTS.filter((s) => s.action.toLowerCase().includes(needle) || s.keys.toLowerCase().includes(needle));
  }, [q]);

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="Help">
      <div className="border-b border-nx-border-strong bg-nx-panel-2 px-2 py-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search commands and shortcuts…"
          aria-label="Search help"
          className="w-full max-w-md bg-nx-inset px-2 py-1 text-[11px] text-nx-text placeholder:text-nx-faint focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-auto bg-nx-border">
        <section className="bg-nx-panel">
          <SectionTitle>Commands</SectionTitle>
          <table className="nx-table">
            <thead>
              <tr><th>Usage</th><th className="!text-left">Aliases</th><th className="!text-left">Description</th><th /></tr>
            </thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.verb}>
                  <td className="font-semibold text-nx-amber">{c.usage}</td>
                  <td className="!text-left text-nx-muted">{c.aliases.join(", ")}</td>
                  <td className="!text-left text-nx-text">{c.description}</td>
                  <td>
                    <button
                      onClick={() => execute(c.takesSymbol ? `${c.verb} AAPL` : c.verb)}
                      className="border border-nx-border px-2 text-[10px] text-nx-cyan hover:bg-nx-panel-2"
                      aria-label={`Run ${c.verb}`}
                    >
                      Run
                    </button>
                  </td>
                </tr>
              ))}
              {commands.length === 0 && (
                <tr><td colSpan={4} className="!text-center text-nx-muted">No commands match “{q}”</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="bg-nx-panel">
          <SectionTitle>Keyboard Shortcuts</SectionTitle>
          <table className="nx-table">
            <tbody>
              {shortcuts.map((s) => (
                <tr key={s.keys}>
                  <td className="w-48 font-semibold text-nx-cyan">{s.keys}</td>
                  <td className="!text-left text-nx-text">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-nx-panel p-3 text-[11px] leading-relaxed text-nx-muted">
          <SectionTitle>About</SectionTitle>
          <p className="mt-1 max-w-2xl">
            NEXUS Terminal is a clean-room financial research platform. The interface, design system,
            and all code are original. In demo mode every market figure is deterministically generated
            <span className="text-nx-purple"> sample data</span> — always labeled, never presented as real.
            NEXUS is research and tracking software only: it does not connect to brokerages and cannot place trades.
          </p>
        </section>
      </div>
    </div>
  );
}
