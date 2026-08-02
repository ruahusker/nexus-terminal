// Workspace layout tree — pure functions (unit-tested).
// A layout is a tree of splits; leaves are tab-groups holding panel instances.

import type { ScreenId } from "./commands";

export interface PanelInstance {
  id: string;
  screen: ScreenId;
  symbol?: string;
}

export interface TabsNode {
  type: "tabs";
  id: string;
  tabs: PanelInstance[];
  active: string | null;
  maximized?: boolean;
}

export interface SplitNode {
  type: "split";
  id: string;
  dir: "row" | "column";
  sizes: number[]; // percentages, same length as children
  children: LayoutNode[];
}

export type LayoutNode = TabsNode | SplitNode;

let counter = 0;
export function nextId(prefix = "p"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function makePanel(screen: ScreenId, symbol?: string): PanelInstance {
  return { id: nextId(), screen, ...(symbol ? { symbol } : {}) };
}

export function makeTabs(panels: PanelInstance[]): TabsNode {
  return { type: "tabs", id: nextId("g"), tabs: panels, active: panels[0]?.id ?? null };
}

export function defaultLayout(): LayoutNode {
  return {
    type: "split",
    id: nextId("s"),
    dir: "row",
    sizes: [55, 45],
    children: [
      makeTabs([makePanel("markets")]),
      {
        type: "split",
        id: nextId("s"),
        dir: "column",
        sizes: [55, 45],
        children: [makeTabs([makePanel("security", "AAPL")]), makeTabs([makePanel("news")])],
      },
    ],
  };
}

/** Depth-first search for a tabs node by id. */
export function findTabs(node: LayoutNode, id: string): TabsNode | null {
  if (node.type === "tabs") return node.id === id ? node : null;
  for (const child of node.children) {
    const hit = findTabs(child, id);
    if (hit) return hit;
  }
  return null;
}

/** First tabs node in the tree (fallback target). */
export function firstTabs(node: LayoutNode): TabsNode {
  if (node.type === "tabs") return node;
  const first = node.children[0];
  if (!first) throw new Error("split with no children");
  return firstTabs(first);
}

export function allTabs(node: LayoutNode): TabsNode[] {
  if (node.type === "tabs") return [node];
  return node.children.flatMap(allTabs);
}

/** Find the tabs node containing a given panel id. */
export function groupOf(node: LayoutNode, panelId: string): TabsNode | null {
  return allTabs(node).find((g) => g.tabs.some((t) => t.id === panelId)) ?? null;
}

function mapNode(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  const mapped = fn(node);
  if (mapped.type === "split") {
    return { ...mapped, children: mapped.children.map((c) => mapNode(c, fn)) };
  }
  return mapped;
}

/** Add a panel as a new tab in `groupId`, or focus the existing tab with same screen+symbol. */
export function openPanel(root: LayoutNode, groupId: string | null, panel: PanelInstance): { root: LayoutNode; panelId: string } {
  const target = groupId ? findTabs(root, groupId) : firstTabs(root);
  const group = target ?? firstTabs(root);
  // Reuse an identical tab if one exists anywhere in that group
  const existing = group.tabs.find((t) => t.screen === panel.screen && t.symbol === panel.symbol);
  if (existing) {
    return { root: mapNode(root, (n) => (n.type === "tabs" && n.id === group.id ? { ...n, active: existing.id } : n)), panelId: existing.id };
  }
  return {
    root: mapNode(root, (n) =>
      n.type === "tabs" && n.id === group.id ? { ...n, tabs: [...n.tabs, panel], active: panel.id } : n,
    ),
    panelId: panel.id,
  };
}

/** Remove a panel; prunes empty groups and collapses degenerate splits. */
export function closePanel(root: LayoutNode, panelId: string): LayoutNode {
  const removed = mapNode(root, (n) => {
    if (n.type === "tabs" && n.tabs.some((t) => t.id === panelId)) {
      const tabs = n.tabs.filter((t) => t.id !== panelId);
      const active = n.active === panelId ? (tabs[tabs.length - 1]?.id ?? null) : n.active;
      return { ...n, tabs, active };
    }
    return n;
  });
  return prune(removed);
}

function prune(node: LayoutNode): LayoutNode {
  if (node.type === "tabs") return node;
  const children = node.children
    .map(prune)
    .filter((c) => (c.type === "tabs" ? c.tabs.length > 0 : true));
  if (children.length === 0) return makeTabs([]); // everything closed
  if (children.length === 1) return children[0] as LayoutNode;
  const sizes = node.sizes.slice(0, children.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => (s / total) * 100) };
}

/** Split the group containing `panelId`, moving the active tab into a new sibling group. */
export function splitGroup(root: LayoutNode, groupId: string, dir: "row" | "column"): LayoutNode {
  const split = (node: LayoutNode): LayoutNode => {
    if (node.type === "tabs") {
      if (node.id !== groupId || node.tabs.length === 0) return node;
      const activeTab = node.tabs.find((t) => t.id === node.active) ?? node.tabs[node.tabs.length - 1];
      if (!activeTab) return node;
      const rest = node.tabs.filter((t) => t.id !== activeTab.id);
      const newGroup = makeTabs([activeTab]);
      const kept: LayoutNode = rest.length > 0 ? { ...node, tabs: rest, active: rest[rest.length - 1]?.id ?? null } : { ...node, tabs: [], active: null };
      const keptOrNew: LayoutNode[] = rest.length > 0 ? [kept, newGroup] : [newGroup, kept];
      return { type: "split", id: nextId("s"), dir, sizes: [50, 50], children: keptOrNew.filter((c) => (c.type === "tabs" ? c.tabs.length > 0 : true)) };
    }
    // If this split already goes the same direction and contains the group, splice instead of nesting
    const idx = node.children.findIndex((c) => c.type === "tabs" && c.id === groupId);
    if (idx !== -1 && node.dir === dir) {
      const group = node.children[idx] as TabsNode;
      const activeTab = group.tabs.find((t) => t.id === group.active) ?? group.tabs[group.tabs.length - 1];
      if (!activeTab || group.tabs.length < 2) return node;
      const rest = group.tabs.filter((t) => t.id !== activeTab.id);
      const newGroup = makeTabs([activeTab]);
      const children = [...node.children];
      children[idx] = { ...group, tabs: rest, active: rest[rest.length - 1]?.id ?? null };
      children.splice(idx + 1, 0, newGroup);
      const each = 100 / children.length;
      return { ...node, children, sizes: children.map(() => each) };
    }
    return { ...node, children: node.children.map(split) };
  };
  return prune(split(root));
}

/** Move a panel to another tab group. */
export function movePanel(root: LayoutNode, panelId: string, toGroupId: string): LayoutNode {
  const from = groupOf(root, panelId);
  const to = findTabs(root, toGroupId);
  if (!from || !to || from.id === to.id) return root;
  const panel = from.tabs.find((t) => t.id === panelId);
  if (!panel) return root;
  const without = closePanel(root, panelId);
  return mapNode(without, (n) =>
    n.type === "tabs" && n.id === toGroupId ? { ...n, tabs: [...n.tabs, panel], active: panel.id } : n,
  );
}

export function setActive(root: LayoutNode, groupId: string, panelId: string): LayoutNode {
  return mapNode(root, (n) => (n.type === "tabs" && n.id === groupId ? { ...n, active: panelId } : n));
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  return mapNode(root, (n) => (n.type === "split" && n.id === splitId ? { ...n, sizes } : n));
}

export function toggleMaximize(root: LayoutNode, groupId: string): LayoutNode {
  const anyMax = allTabs(root).some((g) => g.maximized);
  return mapNode(root, (n) =>
    n.type === "tabs" ? { ...n, maximized: !anyMax && n.id === groupId ? true : undefined } : n,
  );
}

/** Panels in depth-first order — used for Ctrl+1..6 focus. */
export function panelOrder(root: LayoutNode): { groupId: string; panel: PanelInstance }[] {
  const out: { groupId: string; panel: PanelInstance }[] = [];
  for (const g of allTabs(root)) {
    const active = g.tabs.find((t) => t.id === g.active) ?? g.tabs[0];
    if (active) out.push({ groupId: g.id, panel: active });
  }
  return out;
}
