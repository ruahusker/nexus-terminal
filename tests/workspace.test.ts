import { describe, expect, it } from "vitest";
import {
  allTabs, closePanel, defaultLayout, firstTabs, makePanel, makeTabs, movePanel,
  openPanel, panelOrder, setSizes, splitGroup, toggleMaximize, type LayoutNode,
} from "@/lib/workspace";
import { parseCommand } from "@/lib/commands";

function tabCount(root: LayoutNode): number {
  return allTabs(root).reduce((a, g) => a + g.tabs.length, 0);
}

describe("workspace layout tree", () => {
  it("default layout has groups with active tabs", () => {
    const root = defaultLayout();
    expect(allTabs(root).length).toBeGreaterThanOrEqual(3);
    expect(tabCount(root)).toBe(3);
    for (const g of allTabs(root)) expect(g.active).toBe(g.tabs[0]?.id);
  });

  it("openPanel adds a tab and focuses it", () => {
    const root = defaultLayout();
    const gid = firstTabs(root).id;
    const { root: next, panelId } = openPanel(root, gid, makePanel("security", "MSFT"));
    expect(tabCount(next)).toBe(4);
    expect(firstTabs(next).active).toBe(panelId);
  });

  it("openPanel reuses an identical existing tab", () => {
    const root = defaultLayout();
    const gid = allTabs(root)[1]!.id; // group holding AAPL security
    const { root: next } = openPanel(root, gid, makePanel("security", "AAPL"));
    expect(tabCount(next)).toBe(3); // no duplicate
  });

  it("closePanel removes and prunes empty groups", () => {
    const root = defaultLayout();
    const newsGroup = allTabs(root).find((g) => g.tabs[0]?.screen === "news")!;
    const { root: withExtra } = openPanel(root, newsGroup.id, makePanel("alerts"));
    const closed = closePanel(withExtra, newsGroup.tabs[0]!.id);
    expect(tabCount(closed)).toBe(3);
    const closedAll = closePanel(closed, allTabs(closed).find((g) => g.tabs[0]?.screen === "alerts")!.tabs[0]!.id);
    // group pruned entirely — only 2 groups remain
    expect(allTabs(closedAll).length).toBe(2);
  });

  it("splitGroup moves the active tab into a sibling group", () => {
    let root = defaultLayout();
    const gid = firstTabs(root).id;
    root = openPanel(root, gid, makePanel("screener")).root;
    const before = tabCount(root);
    const split = splitGroup(root, gid, "row");
    expect(tabCount(split)).toBe(before);
    expect(allTabs(split).length).toBe(4);
  });

  it("movePanel relocates a tab between groups", () => {
    const root = defaultLayout();
    const groups = allTabs(root);
    const panel = groups[0]!.tabs[0]!;
    const targetId = groups[1]!.id;
    const moved = movePanel(root, panel.id, targetId);
    // source group is pruned after its last tab leaves; target keeps its id
    const target = allTabs(moved).find((g) => g.id === targetId);
    expect(target?.tabs.some((t) => t.id === panel.id)).toBe(true);
  });

  it("toggleMaximize is exclusive and reversible", () => {
    const root = defaultLayout();
    const gid = firstTabs(root).id;
    const maxed = toggleMaximize(root, gid);
    expect(allTabs(maxed).filter((g) => g.maximized).length).toBe(1);
    const restored = toggleMaximize(maxed, gid);
    expect(allTabs(restored).filter((g) => g.maximized).length).toBe(0);
  });

  it("setSizes and panelOrder behave", () => {
    const root = defaultLayout();
    const splitId = root.type === "split" ? root.id : "";
    const resized = setSizes(root, splitId, [70, 30]);
    expect(resized.type === "split" && resized.sizes[0]).toBe(70);
    expect(panelOrder(root).length).toBe(3);
  });

  it("closing everything leaves a single empty group, never a broken tree", () => {
    let root = defaultLayout();
    for (const g of allTabs(root)) {
      for (const t of [...g.tabs]) root = closePanel(root, t.id);
    }
    expect(allTabs(root).length).toBe(1);
  });
});

describe("command parser", () => {
  it("parses bare symbols", () => {
    const r = parseCommand("aapl");
    expect(r.kind).toBe("symbol");
    expect(r.symbol).toBe("AAPL");
    expect(r.screen).toBe("security");
  });
  it("parses verb + symbol", () => {
    const r = parseCommand("CHART nvda");
    expect(r.screen).toBe("chart");
    expect(r.symbol).toBe("NVDA");
  });
  it("parses aliases", () => {
    expect(parseCommand("DES AAPL").screen).toBe("security");
    expect(parseCommand("FA AAPL").screen).toBe("security");
    expect(parseCommand("OMON SPY").screen).toBe("options");
  });
  it("parses no-symbol commands", () => {
    expect(parseCommand("PORTFOLIO").screen).toBe("portfolio");
    expect(parseCommand("HELP").screen).toBe("help");
    expect(parseCommand("MARKETS").screen).toBe("markets");
  });
  it("errors when a symbol is required but missing", () => {
    expect(parseCommand("QUOTE").error).toMatch(/requires a symbol/);
  });
  it("errors on unrecognized input", () => {
    expect(parseCommand("FOOBAR BAZ").error).toMatch(/Unrecognized/);
  });
  it("empty input is empty", () => {
    expect(parseCommand("   ").kind).toBe("empty");
  });
});
