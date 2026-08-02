// Command registry and parser. A command maps free-text input to a panel intent.

export type ScreenId =
  | "markets" | "security" | "chart" | "options" | "portfolio" | "watchlist"
  | "news" | "screener" | "economy" | "alerts" | "help";

export interface CommandDef {
  verb: string;
  aliases: string[];
  takesSymbol: boolean;
  screen: ScreenId;
  usage: string;
  description: string;
}

export const COMMANDS: CommandDef[] = [
  { verb: "QUOTE", aliases: ["Q", "DES"], takesSymbol: true, screen: "security", usage: "QUOTE <SYM>", description: "Security overview: quote, stats, profile, fundamentals" },
  { verb: "CHART", aliases: ["C", "GP"], takesSymbol: true, screen: "chart", usage: "CHART <SYM>", description: "Advanced chart with indicators and comparisons" },
  { verb: "OPTIONS", aliases: ["OPT", "OMON"], takesSymbol: true, screen: "options", usage: "OPTIONS <SYM>", description: "Options chain, greeks, strategy builder, P/L" },
  { verb: "FINANCIALS", aliases: ["FA", "FIN"], takesSymbol: true, screen: "security", usage: "FINANCIALS <SYM>", description: "Financial statements, earnings, estimates" },
  { verb: "NEWS", aliases: ["N"], takesSymbol: false, screen: "news", usage: "NEWS [SYM]", description: "Market news feed; optional symbol filter" },
  { verb: "PORTFOLIO", aliases: ["PORT", "PRTU"], takesSymbol: false, screen: "portfolio", usage: "PORTFOLIO", description: "Portfolio analytics and performance" },
  { verb: "WATCHLIST", aliases: ["W", "WL"], takesSymbol: false, screen: "watchlist", usage: "WATCHLIST", description: "Watchlists with live quotes" },
  { verb: "MARKETS", aliases: ["M", "WEI"], takesSymbol: false, screen: "markets", usage: "MARKETS", description: "Global market overview" },
  { verb: "ECONOMY", aliases: ["ECO", "ECOF"], takesSymbol: false, screen: "economy", usage: "ECONOMY", description: "Economic calendar, indicators, yield curve" },
  { verb: "CRYPTO", aliases: ["XBT"], takesSymbol: true, screen: "security", usage: "CRYPTO <SYM>", description: "Crypto asset overview (e.g. CRYPTO BTC)" },
  { verb: "SCREENER", aliases: ["SCR", "EQS"], takesSymbol: false, screen: "screener", usage: "SCREENER", description: "Equity screener with saved screens" },
  { verb: "ALERTS", aliases: ["ALRT"], takesSymbol: false, screen: "alerts", usage: "ALERTS", description: "Price, volume, and event alerts" },
  { verb: "HELP", aliases: ["H", "?"], takesSymbol: false, screen: "help", usage: "HELP", description: "Command reference and keyboard shortcuts" },
];

export interface ParsedCommand {
  kind: "command" | "symbol" | "empty";
  screen?: ScreenId;
  symbol?: string;
  raw: string;
  error?: string;
}

export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  if (!raw) return { kind: "empty", raw };
  const upper = raw.toUpperCase();
  const tokens = upper.split(/\s+/);
  const head = tokens[0] as string;
  const def = COMMANDS.find((c) => c.verb === head || c.aliases.includes(head));
  if (def) {
    const symbol = tokens[1];
    if (def.takesSymbol && !symbol) {
      return { kind: "command", raw, error: `${def.verb} requires a symbol — usage: ${def.usage}` };
    }
    return { kind: "command", screen: def.screen, symbol, raw };
  }
  // Bare symbol → security overview
  if (/^[A-Z0-9.\-^=]{1,12}$/.test(head) && tokens.length === 1) {
    return { kind: "symbol", screen: "security", symbol: head, raw };
  }
  return { kind: "command", raw, error: `Unrecognized command "${raw}" — type HELP for the command list` };
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "` or Ctrl+K", action: "Focus the command bar" },
  { keys: "Enter", action: "Execute command / open selection" },
  { keys: "↑ / ↓", action: "Browse autocomplete & command history" },
  { keys: "Esc", action: "Clear bar / unfocus" },
  { keys: "Ctrl+1 … Ctrl+6", action: "Focus workspace panel 1–6" },
  { keys: "Alt+X", action: "Close the focused panel tab" },
  { keys: "Alt+M", action: "Maximize / restore the focused panel" },
  { keys: "Alt+→ / Alt+↓", action: "Split the focused panel right / down" },
];
