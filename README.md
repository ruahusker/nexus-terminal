# NEXUS Terminal

A professional, Bloomberg-Terminal–inspired financial research platform — **clean-room implementation** with an original design system, original code, and no third-party branding or proprietary data.

Desktop-first web app for researching stocks, ETFs, options, indexes, crypto, FX, economic indicators, filings, news, and your own portfolios and watchlists.

**Live deployment:** `https://vibeprojects.us/terminal` (nginx reverse proxy → Next.js on 127.0.0.1:3141, Let's Encrypt TLS, login required).

---

## Quick start (demo mode — no API keys needed)

```bash
npm install
npm run db:setup     # prisma generate + create SQLite DB + seed instrument universe
npm run dev          # http://localhost:3141/terminal
```

The app serves under the `/terminal` base path (see `next.config.ts`).

### Accounts

The terminal requires sign-in. Registration is closed by default (`NEXUS_REGISTRATION="closed"` in `.env`); create accounts from the CLI:

```bash
node --experimental-strip-types prisma/create-user.ts <username> <password> [name]
```

Each new account is provisioned with a starter watchlist and demo portfolio. Passwords are scrypt-hashed; sessions are 30-day httpOnly cookies (only SHA-256 token hashes are stored). All API routes require a session; user data (portfolios, watchlists, alerts, drawings, saved items, workspace) is scoped per account.

Demo mode serves **deterministic, seeded sample data** for a 135-instrument universe, always labeled `SAMPLE DATA`.

Production:

```bash
npm run build && npm start   # serves 127.0.0.1:3141/terminal
```

## Tests

```bash
npm test             # Vitest unit tests
npm run test:e2e     # Playwright (logs in via e2e/auth.setup.ts; override creds with NEXUS_E2E_USER / NEXUS_E2E_PASSWORD)
npm run typecheck    # tsc --noEmit (strict + noUncheckedIndexedAccess)
```

## The command bar

Press <kbd>`</kbd> (backtick) or <kbd>Ctrl+K</kbd> anywhere to focus the bar. Type a symbol or a command:

| Command | Action |
| --- | --- |
| `AAPL` | Security overview for a symbol |
| `QUOTE <SYM>` / `DES <SYM>` | Security overview |
| `CHART <SYM>` | Advanced chart |
| `OPTIONS <SYM>` | Options chain + strategy builder |
| `FINANCIALS <SYM>` / `FA <SYM>` | Statements, earnings, estimates |
| `NEWS [SYM]` | News feed (optional symbol filter) |
| `PORTFOLIO` | Portfolio analytics |
| `WATCHLIST` | Watchlists with streaming quotes |
| `MARKETS` | Global market overview |
| `ECONOMY` | Economic calendar, indicators, yield curve |
| `CRYPTO BTC` | Crypto overview |
| `SCREENER` | Equity screener |
| `ALERTS` | Alert manager |
| `AI` | AI assistant — ask in plain English, it queries terminal data for you |
| `HELP` | Searchable command + shortcut reference |

Shortcuts: <kbd>↑</kbd>/<kbd>↓</kbd> autocomplete & history · <kbd>Enter</kbd> execute · <kbd>Esc</kbd> clear/close · <kbd>Ctrl+1…6</kbd> focus panel · <kbd>Alt+X</kbd> close tab · <kbd>Alt+M</kbd> maximize · <kbd>Alt+→</kbd>/<kbd>Alt+↓</kbd> split panel.

- Toolbar: chart types, ranges, indicators, comparisons, saved layouts — plus **drawing tools** (trend line, ray, horizontal line, rectangle, fib retracement). Drawings are anchored in time/price, persist per user per symbol (`/api/drawings`), and survive timeframe changes. Click a drawing with the pointer tool to select, Delete to remove; "Clear all" wipes the symbol's drawings.

## Architecture

```
src/
  app/
    page.tsx              # terminal shell (command bar / workspace / status bar)
    api/                  # server-side routes — the ONLY place providers are called
      search quote bars options markets news screener economy fundamentals filings stream (SSE)
      portfolios/[id]/{transactions,import} watchlists alerts/check workspace saved
  components/             # TerminalContext (workspace state), CommandBar, WorkspaceView, StatusBar, ui primitives
  screens/                # 11 screens registered in screens/index.tsx
  lib/
    types.ts              # domain model — every datum carries provider/timestamp/status
    demo/                 # deterministic seeded demo engine (rng → prices, chains, news, economy)
    providers/            # swappable adapter layer: Yahoo, Massive, Coinbase, RSS, EDGAR
    blackScholes.ts indicators.ts format.ts rng.ts commands.ts workspace.ts
prisma/
  schema.prisma           # instruments, portfolios, positions, transactions, watchlists,
                          # alerts, workspaces, saved screens/articles/chart layouts
  seed.ts                 # instrument universe + starter watchlists + demo portfolio
```

### Data modes

- **Demo mode** (`NEXUS_DATA_MODE=demo`, default for fresh clones): every market figure is a pure function of `(symbol, time)` from a seeded RNG — reproducible, always labeled `SAMPLE`.
- **Provider mode** (`NEXUS_DATA_MODE=provider`): real data per capability, routed through swappable server-side adapters (keys never reach the browser; rate limits and outages surface as explicit UI errors — never silently replaced with invented values):

| Capability | Provider | Notes |
| --- | --- | --- |
| Equity/ETF quotes | Robinhood MCP when `ROBINHOOD_MCP_TOKEN_PATH` is set; otherwise Yahoo (keyless) | real-time bid/ask/last, labeled REALTIME (Yahoo path labeled DELAYED) |
| Equity/ETF bars | Robinhood MCP when configured, then Massive (Polygon-compatible), then Yahoo | 1m–1wk aggregates |
| Crypto quotes + bars | Coinbase | public, no key |
| FX / commodity quotes + bars | Yahoo (keyless) | labeled DELAYED |
| US index quotes + bars (SPX, NDX, VIX) | Robinhood MCP when configured; otherwise Yahoo | real-time levels via Robinhood (DJI/RUT not served by the MCP) |
| Options chains | Robinhood MCP when configured; otherwise Yahoo (keyless) | Robinhood: real strikes/quotes + published IV and greeks; Yahoo: real IV, greeks via Black-Scholes; labeled SAMPLE fallback when both fail |
| News | RSS — Yahoo Finance, CNBC, MarketWatch | real headlines, no key |
| Filings | SEC EDGAR | real filings with Archives links |
| Fundamentals (statements, earnings, analysts, profile) | Robinhood MCP primary; Yahoo (keyless) fills balance sheet / cash flow / analysts | Robinhood: real valuation ratios, annual income periods, EPS results; Yahoo: real 4-year statements via fundamentals-timeseries; labeled SAMPLE fallback when both fail |
| Screener | Yahoo quotes + universe metadata | real prices; margin/ROE/RSI/IV columns have no free source and show “—” |
| Economy (series, release calendar) | FRED | real series + scheduled release dates; forecasts show “—” (FRED has no consensus) |
| Treasury yield curve | Yahoo yield indexes | real 3M/5Y/10Y/30Y |

Where a provider isn't configured (or, for options, rate-limited), that capability falls back to **labeled** demo data; every datum carries `{ provider, asOf, status }` (∈ `REALTIME | DELAYED | CACHED | SAMPLE`) shown in the UI.

The Robinhood MCP adapter is **read-only** (market data only — no account or order tools): it reads `tokens.access_token` from `ROBINHOOD_MCP_TOKEN_PATH` (default `/home/main/trading/.secrets/robinhood_mcp_oauth.json`) and never refreshes it — token refresh is owned by the external `/trading` overnight-quote-logger service, and a 401 is handled by re-reading the file once.

### Design system

Near-black canvas (`#0a0a0b`), amber primary accent (`#f5a524`), green/red directional colors always paired with ▲/▼ glyphs (color is never the only signal), cyan links, monospaced numerals with `tabular-nums`, thin 1px borders, dense tables, no gradients or rounded cards.

### Workspace

Panels are a tree of resizable splits with tab groups (`src/lib/workspace.ts`, pure and unit-tested). Open/close/split/maximize/drag-to-move panels; the layout persists to `localStorage` and the server (`/api/workspace`) across sessions.

## CSV portfolio import format

Header required; one transaction per row:

```csv
symbol,side,quantity,price,date,fees,note
AAPL,BUY,10,150.25,2024-01-15,0,initial
MSFT,SELL,5,400.10,2024-03-02,0,rebalance
USD,DEPOSIT,5000,0,2024-01-01,0,funding
```

- `side` ∈ `BUY | SELL | DEPOSIT | WITHDRAWAL` (DEPOSIT/WITHDRAWAL move cash; `quantity` is the cash amount)
- All rows are validated and sanitized; the import is **all-or-nothing** with row-level error messages.

## Honest limitations (by design)

- Options marks for portfolio positions are held at cost (no live per-contract quotes in demo).
- Alerts: price and volume conditions are evaluated server-side every 30s while the app is open; event-based alert kinds are not offered because they are not implemented.
- News and filings in demo mode are generated sample text and are labeled as such everywhere; nothing is fabricated to look real.
- Analyst estimates, fundamentals, and probability figures (e.g. probability of profit) are model/sample estimates with visible caveats — never presented as guarantees.
- NEXUS is research/tracking software only. It does not connect to brokerages and cannot place trades.

## AI assistant

The `AI` screen (Kimi-backed) answers plain-English questions by calling the terminal's own data tools — quotes, bars, screener, fundamentals, options chains, news — through a server-side agent loop, and shows the tool trace under each answer. Examples: "stocks with a high PE that pulled back 15%+ from their 52-week high", "how far is BTC from its 200-day moving average?". Requires `KIMI_API_KEY` (platform key from platform.moonshot.cn; the kimi CLI's own credential does not work for direct API calls). Without a key the screen explains the setup. The assistant is read-only — it cannot place trades.

## Environment

See `.env.example`. Everything is optional; with no configuration the app runs fully in demo mode on SQLite (`prisma/nexus.db`).
