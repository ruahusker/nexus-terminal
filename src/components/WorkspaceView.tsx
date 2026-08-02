"use client";

// Renders the workspace layout tree: resizable splits, tab groups, panel chrome.

import { useCallback, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { useTerminal } from "./TerminalContext";
import { SCREENS, screenTitle } from "@/screens";
import { allTabs, type LayoutNode, type PanelInstance, type TabsNode } from "@/lib/workspace";

function PanelChrome({ group, panel, index }: { group: TabsNode; panel: PanelInstance; index: number }) {
  const { focus, updateSymbol } = useTerminal();
  const [editing, setEditing] = useState(false);
  const [sym, setSym] = useState(panel.symbol ?? "");
  const Screen = SCREENS[panel.screen];
  const commit = () => {
    setEditing(false);
    const v = sym.trim().toUpperCase();
    if (v && v !== panel.symbol) updateSymbol(panel.id, group.id, v);
  };
  return (
    <div
      id={`panel-${panel.id}`}
      tabIndex={-1}
      role="region"
      aria-label={screenTitle(panel.screen, panel.symbol)}
      onFocus={() => focus(group.id)}
      onMouseDown={() => focus(group.id)}
      className="flex h-full flex-col overflow-hidden outline-none"
    >
      {panel.screen !== "markets" && panel.screen !== "help" && panel.symbol !== undefined && (
        <div className="flex items-center gap-1 border-b border-nx-border bg-nx-panel px-2 py-0.5 text-[10px] text-nx-muted">
          {editing ? (
            <input
              autoFocus
              value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              aria-label="Change panel symbol"
              className="w-20 bg-nx-inset px-1 text-nx-amber focus:outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setSym(panel.symbol ?? "");
                setEditing(true);
              }}
              className="text-nx-amber hover:underline"
              title="Click to change symbol"
            >
              {panel.symbol ?? "—"}
            </button>
          )}
          <span className="text-nx-faint">· panel {index + 1}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Screen symbol={panel.symbol} />
      </div>
    </div>
  );
}

function TabsView({ node, panelIndex }: { node: TabsNode; panelIndex: Map<string, number> }) {
  const { activate, close, focus, maximize, split, root, move } = useTerminal();
  const [dragOver, setDragOver] = useState(false);
  const activePanel = node.tabs.find((t) => t.id === node.active) ?? node.tabs[0];

  const onDragStart = (e: React.DragEvent, panelId: string) => {
    e.dataTransfer.setData("text/nexus-panel", panelId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const panelId = e.dataTransfer.getData("text/nexus-panel");
    if (panelId) move(panelId, node.id);
  };

  if (node.tabs.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center text-[11px] text-nx-faint ${dragOver ? "bg-nx-amber/5" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        Empty panel — run a command or drag a tab here
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col bg-nx-panel ${dragOver ? "ring-1 ring-inset ring-nx-amber" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-stretch border-b border-nx-border-strong bg-nx-panel" role="tablist" aria-label="Panel tabs">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {node.tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === (activePanel?.id ?? "")}
              data-active={t.id === (activePanel?.id ?? "")}
              className="nx-tab"
              draggable
              onDragStart={(e) => onDragStart(e, t.id)}
              onClick={() => activate(node.id, t.id)}
              title={screenTitle(t.screen, t.symbol)}
            >
              {screenTitle(t.screen, t.symbol)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-px border-l border-nx-border px-1">
          <button onClick={() => split("row")} title="Split right (Alt+→)" aria-label="Split panel right" className="px-1 text-nx-muted hover:text-nx-amber">◫</button>
          <button onClick={() => split("column")} title="Split down (Alt+↓)" aria-label="Split panel down" className="px-1 text-nx-muted hover:text-nx-amber">⬓</button>
          <button onClick={maximize} title="Maximize (Alt+M)" aria-label="Maximize panel" className="px-1 text-nx-muted hover:text-nx-amber">▢</button>
          {activePanel && (
            <button onClick={() => close(activePanel.id)} title="Close tab (Alt+X)" aria-label="Close panel" className="px-1 text-nx-muted hover:text-nx-down">✕</button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1" onMouseDown={() => focus(node.id)}>
        {activePanel && <PanelChrome group={node} panel={activePanel} index={panelIndex.get(activePanel.id) ?? 0} />}
      </div>
    </div>
  );
}

function NodeView({ node, panelIndex }: { node: LayoutNode; panelIndex: Map<string, number> }) {
  const { resize, root } = useTerminal();
  const maximized = allTabs(root).find((g) => g.maximized);

  // If a group is maximized, render only it
  if (node.type !== "tabs" && maximized) {
    const found = (function find(n: LayoutNode): TabsNode | null {
      if (n.type === "tabs") return n.maximized ? n : null;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    })(node);
    if (found) return <TabsView node={found} panelIndex={panelIndex} />;
  }
  if (node.type === "tabs") {
    if (maximized && !node.maximized) return null;
    return <TabsView node={node} panelIndex={panelIndex} />;
  }
  const onLayout = useCallback(
    (sizes: number[]) => resize(node.id, sizes),
    [resize, node.id],
  );
  return (
    <PanelGroup direction={node.dir === "row" ? "horizontal" : "vertical"} onLayout={onLayout} className="h-full">
      {node.children.map((child, i) => (
        <FragmentWithHandle
          key={child.id}
          first={i === 0}
          size={node.sizes[i] ?? 100 / node.children.length}
          dir={node.dir}
        >
          <NodeView node={child} panelIndex={panelIndex} />
        </FragmentWithHandle>
      ))}
    </PanelGroup>
  );
}

import { Fragment } from "react";

function FragmentWithHandle({ children, first, size, dir }: { children: React.ReactNode; first: boolean; size: number; dir: "row" | "column" }) {
  return (
    <Fragment>
      {!first && (
        <PanelResizeHandle
          className={`nx-resize-handle ${dir === "row" ? "w-px" : "h-px"}`}
          aria-label="Resize panels"
        />
      )}
      <Panel defaultSize={size} minSize={8}>
        {children}
      </Panel>
    </Fragment>
  );
}

export function WorkspaceView() {
  const { root } = useTerminal();
  const panelIndex = new Map<string, number>();
  allTabs(root).forEach((g, i) => {
    const active = g.tabs.find((t) => t.id === g.active) ?? g.tabs[0];
    if (active) panelIndex.set(active.id, i);
  });
  return (
    <div className="h-full min-h-0 bg-nx-bg p-px">
      <NodeView node={root} panelIndex={panelIndex} />
    </div>
  );
}
