"use client";

import { useEffect, useState } from "react";
import { TerminalProvider } from "@/components/TerminalContext";
import { CommandBar } from "@/components/CommandBar";
import { WorkspaceView } from "@/components/WorkspaceView";
import { StatusBar } from "@/components/StatusBar";
import { BreakingBanner } from "@/components/BreakingBanner";

const ZOOM_KEY = "nexus-zoom";
const DEFAULT_ZOOM = 1.3;

export default function Home() {
  // The workspace layout uses generated ids (Date.now()-based) and restores
  // from localStorage/server — render it client-side only to avoid any
  // server/client markup divergence.
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = Number(localStorage.getItem(ZOOM_KEY));
      if (Number.isFinite(saved) && saved >= 0.85 && saved <= 1.6) setZoom(saved);
    } catch { /* ignore */ }
  }, []);

  const changeZoom = (next: number) => {
    const clamped = Math.min(1.6, Math.max(0.85, Math.round(next * 100) / 100));
    setZoom(clamped);
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch { /* ignore */ }
  };

  return (
    <TerminalProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <BreakingBanner />
        <CommandBar />
        {/* Zoom applies to the workspace only — command bar, news crawl, and
            status bar stay pinned to the viewport edges at every zoom level. */}
        <main className="min-h-0 flex-1" style={{ zoom }}>
          {mounted && <WorkspaceView />}
        </main>
        <StatusBar zoom={zoom} onZoom={changeZoom} />
      </div>
    </TerminalProvider>
  );
}
