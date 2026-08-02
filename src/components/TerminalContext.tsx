"use client";

// Workspace state: layout tree, focus, persistence (server + localStorage fallback),
// command execution, and alert notifications.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import type { ScreenId } from "@/lib/commands";
import { parseCommand } from "@/lib/commands";
import {
  closePanel, defaultLayout, findTabs, firstTabs, makePanel, movePanel, openPanel,
  panelOrder, setActive, setSizes, splitGroup, toggleMaximize, type LayoutNode,
} from "@/lib/workspace";
import { api } from "@/lib/client";

interface AlertToast {
  id: string;
  message: string;
  at: number;
}

interface TerminalState {
  root: LayoutNode;
  focusGroup: string | null;
  commandBarOpen: boolean;
  toasts: AlertToast[];
  open: (screen: ScreenId, symbol?: string) => void;
  execute: (input: string) => string | null; // returns error message or null
  close: (panelId: string) => void;
  activate: (groupId: string, panelId: string) => void;
  focus: (groupId: string | null) => void;
  split: (dir: "row" | "column") => void;
  maximize: () => void;
  move: (panelId: string, toGroupId: string) => void;
  resize: (splitId: string, sizes: number[]) => void;
  setCommandBarOpen: (open: boolean) => void;
  updateSymbol: (panelId: string, groupId: string, symbol: string) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<TerminalState | null>(null);

export function useTerminal(): TerminalState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTerminal outside provider");
  return ctx;
}

const LS_KEY = "nexus-workspace-v1";

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<LayoutNode>(() => defaultLayout());
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted layout: server first, localStorage fallback
  useEffect(() => {
    (async () => {
      // Local copy is authoritative for this browser (it's written synchronously
      // on every change); the server copy is the fallback for fresh devices.
      let layout: LayoutNode | null = null;
      try {
        const raw = localStorage.getItem(LS_KEY);
        layout = raw ? (JSON.parse(raw) as LayoutNode) : null;
      } catch { /* corrupt storage → try server */ }
      if (!layout) {
        try {
          layout = await api<LayoutNode | null>("/api/workspace");
        } catch { /* offline → default */ }
      }
      if (layout && typeof layout === "object") setRoot(layout);
      setHydrated(true);
    })();
  }, []);

  // Persist (debounced) to both localStorage and server
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(root));
    } catch { /* storage full/blocked */ }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api("/api/workspace", { method: "PUT", body: JSON.stringify({ layout: JSON.stringify(root) }) }).catch(() => {});
    }, 1200);
  }, [root, hydrated]);

  const focus = useCallback((groupId: string | null) => setFocusGroup(groupId), []);

  const open = useCallback((screen: ScreenId, symbol?: string) => {
    setRoot((r) => {
      const { root: next } = openPanel(r, focusGroup, makePanel(screen, symbol));
      return next;
    });
  }, [focusGroup]);

  const execute = useCallback((input: string): string | null => {
    const parsed = parseCommand(input);
    if (parsed.kind === "empty") return null;
    if (parsed.error) return parsed.error;
    if (parsed.screen) open(parsed.screen, parsed.symbol);
    return null;
  }, [open]);

  const close = useCallback((panelId: string) => setRoot((r) => closePanel(r, panelId)), []);
  const activate = useCallback((groupId: string, panelId: string) => {
    setRoot((r) => setActive(r, groupId, panelId));
    setFocusGroup(groupId);
  }, []);
  const split = useCallback((dir: "row" | "column") => {
    setRoot((r) => {
      const gid = focusGroup ?? firstTabs(r).id;
      return splitGroup(r, gid, dir);
    });
  }, [focusGroup]);
  const maximize = useCallback(() => {
    setRoot((r) => toggleMaximize(r, focusGroup ?? firstTabs(r).id));
  }, [focusGroup]);
  const move = useCallback((panelId: string, toGroupId: string) => {
    setRoot((r) => movePanel(r, panelId, toGroupId));
  }, []);
  const resize = useCallback((splitId: string, sizes: number[]) => {
    setRoot((r) => setSizes(r, splitId, sizes));
  }, []);
  const updateSymbol = useCallback((panelId: string, groupId: string, symbol: string) => {
    setRoot((r) => {
      const g = findTabs(r, groupId);
      if (!g) return r;
      const next = {
        ...g,
        tabs: g.tabs.map((t) => (t.id === panelId ? { ...t, symbol } : t)),
      };
      const replace = (n: LayoutNode): LayoutNode => {
        if (n.type === "tabs") return n.id === groupId ? next : n;
        return { ...n, children: n.children.map(replace) };
      };
      return replace(r);
    });
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Alert polling every 30s → toast notifications
  useEffect(() => {
    const check = async () => {
      try {
        const res = await api<{ triggered: { alertId: string; message: string }[] }>("/api/alerts/check", { method: "POST" });
        if (res.triggered.length > 0) {
          setToasts((t) => [
            ...t,
            ...res.triggered.map((x) => ({ id: `${x.alertId}-${Date.now()}`, message: x.message, at: Date.now() })),
          ]);
        }
      } catch { /* alerts are best-effort */ }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "`" && !e.ctrlKey && !e.metaKey && !inInput) {
        e.preventDefault();
        setCommandBarOpen(true);
      } else if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setCommandBarOpen(true);
      } else if (e.altKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        setRoot((r) => {
          const gid = focusGroup ?? firstTabs(r).id;
          const g = findTabs(r, gid);
          const active = g?.active;
          return active ? closePanel(r, active) : r;
        });
      } else if (e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        maximize();
      } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
        e.preventDefault();
        split(e.key === "ArrowRight" ? "row" : "column");
      } else if (e.ctrlKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const entry = panelOrder(root)[idx];
        if (entry) {
          setFocusGroup(entry.groupId);
          document.getElementById(`panel-${entry.panel.id}`)?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusGroup, maximize, split, root]);

  const value = useMemo<TerminalState>(() => ({
    root, focusGroup, commandBarOpen, toasts,
    open, execute, close, activate, focus, split, maximize, move, resize,
    setCommandBarOpen, updateSymbol, dismissToast,
  }), [root, focusGroup, commandBarOpen, toasts, open, execute, close, activate, focus, split, maximize, move, resize, updateSymbol, dismissToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
