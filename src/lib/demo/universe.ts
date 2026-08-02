// Demo instrument universe. Publicly-known names with approximate anchor
// values used solely to seed deterministic SAMPLE data — not live market data.

import type { AssetClass } from "../types";

export interface UniverseEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  currency: string;
  sector?: string;
  industry?: string;
  country?: string;
  basePrice: number;
  marketCap?: number; // USD
  sharesOut?: number;
  dividendYield?: number; // decimal
  peRatio?: number;
  beta?: number;
  description?: string;
  optionable?: boolean;
  vol?: number; // annualized vol assumption for demo price paths
}

const S = (
  symbol: string, name: string, sector: string, industry: string, basePrice: number,
  marketCapB: number, opts: Partial<UniverseEntry> = {},
): UniverseEntry => ({
  symbol, name, assetClass: "STOCK", exchange: opts.exchange ?? "NASDAQ", currency: "USD",
  sector, industry, basePrice, marketCap: marketCapB * 1e9,
  sharesOut: (marketCapB * 1e9) / basePrice, country: "US", ...opts,
});

export const UNIVERSE: UniverseEntry[] = [
  // ── Mega-cap technology ──
  S("AAPL", "Apple Inc.", "Technology", "Consumer Electronics", 227.5, 3450, { dividendYield: 0.0044, peRatio: 34.5, beta: 1.24, optionable: true, vol: 0.26, description: "Designs and sells smartphones, personal computers, tablets, wearables, and related services worldwide." }),
  S("MSFT", "Microsoft Corp.", "Technology", "Software—Infrastructure", 428.2, 3180, { dividendYield: 0.0072, peRatio: 36.1, beta: 0.9, optionable: true, vol: 0.24, description: "Develops software, cloud services, devices, and AI solutions including Azure, Office, and Windows." }),
  S("NVDA", "NVIDIA Corp.", "Technology", "Semiconductors", 138.4, 3390, { dividendYield: 0.0003, peRatio: 54.2, beta: 1.68, optionable: true, vol: 0.52, description: "Designs GPUs and accelerated computing platforms for gaming, data centers, AI, and automotive markets." }),
  S("GOOGL", "Alphabet Inc. Class A", "Communication Services", "Internet Content & Information", 178.3, 2190, { dividendYield: 0.0045, peRatio: 23.8, beta: 1.01, optionable: true, vol: 0.28, description: "Operates Google Search, YouTube, Android, Google Cloud, and other internet services." }),
  S("AMZN", "Amazon.com Inc.", "Consumer Discretionary", "Internet Retail", 205.7, 2160, { peRatio: 44.0, beta: 1.15, optionable: true, vol: 0.33, description: "Operates e-commerce marketplaces, AWS cloud computing, advertising, and entertainment services." }),
  S("META", "Meta Platforms Inc.", "Communication Services", "Internet Content & Information", 585.2, 1480, { dividendYield: 0.0034, peRatio: 27.9, beta: 1.22, optionable: true, vol: 0.35, description: "Operates Facebook, Instagram, WhatsApp, and Reality Labs immersive computing platforms." }),
  S("TSLA", "Tesla Inc.", "Consumer Discretionary", "Auto Manufacturers", 342.1, 1100, { peRatio: 92.0, beta: 2.31, optionable: true, vol: 0.58, description: "Designs and manufactures electric vehicles, energy storage, and solar products." }),
  S("AVGO", "Broadcom Inc.", "Technology", "Semiconductors", 172.8, 810, { dividendYield: 0.0122, peRatio: 38.4, beta: 1.31, optionable: true, vol: 0.4 }),
  S("ORCL", "Oracle Corp.", "Technology", "Software—Infrastructure", 172.4, 476, { dividendYield: 0.0093, peRatio: 41.2, beta: 1.02, optionable: true, vol: 0.3 }),
  S("AMD", "Advanced Micro Devices", "Technology", "Semiconductors", 122.5, 198, { peRatio: 45.1, beta: 1.69, optionable: true, vol: 0.48 }),
  S("INTC", "Intel Corp.", "Technology", "Semiconductors", 21.4, 92, { dividendYield: 0.0, peRatio: null as never, beta: 1.06, optionable: true, vol: 0.42 }),
  S("CRM", "Salesforce Inc.", "Technology", "Software—Application", 331.9, 318, { dividendYield: 0.0048, peRatio: 55.3, beta: 1.29, optionable: true, vol: 0.32 }),
  S("ADBE", "Adobe Inc.", "Technology", "Software—Application", 442.6, 196, { peRatio: 35.6, beta: 1.31, optionable: true, vol: 0.31 }),
  S("QCOM", "Qualcomm Inc.", "Technology", "Semiconductors", 158.9, 177, { dividendYield: 0.0214, peRatio: 17.2, beta: 1.25, optionable: true, vol: 0.33 }),
  S("TXN", "Texas Instruments", "Technology", "Semiconductors", 192.3, 175, { dividendYield: 0.0283, peRatio: 35.0, beta: 1.0, optionable: true, vol: 0.27 }),
  S("NOW", "ServiceNow Inc.", "Technology", "Software—Application", 1042.0, 214, { peRatio: 152.0, beta: 0.99, optionable: true, vol: 0.32 }),
  S("IBM", "IBM Corp.", "Technology", "Information Technology Services", 232.8, 215, { dividendYield: 0.0288, peRatio: 23.9, beta: 0.73, optionable: true, vol: 0.22 }),
  S("CSCO", "Cisco Systems", "Technology", "Communication Equipment", 58.4, 232, { dividendYield: 0.0274, peRatio: 21.6, beta: 0.88, optionable: true, vol: 0.22 }),
  S("MU", "Micron Technology", "Technology", "Semiconductors", 98.7, 110, { dividendYield: 0.0047, peRatio: 27.8, beta: 1.18, optionable: true, vol: 0.5 }),
  S("PLTR", "Palantir Technologies", "Technology", "Software—Infrastructure", 84.2, 192, { peRatio: 240.0, beta: 2.68, optionable: true, vol: 0.62 }),

  // ── Financials ──
  S("JPM", "JPMorgan Chase & Co.", "Financials", "Banks—Diversified", 244.8, 688, { exchange: "NYSE", dividendYield: 0.0204, peRatio: 13.2, beta: 1.1, optionable: true, vol: 0.24, description: "Global diversified bank offering consumer, commercial, investment banking, and asset management." }),
  S("BAC", "Bank of America Corp.", "Financials", "Banks—Diversified", 45.6, 354, { exchange: "NYSE", dividendYield: 0.0228, peRatio: 13.8, beta: 1.32, optionable: true, vol: 0.27 }),
  S("WFC", "Wells Fargo & Co.", "Financials", "Banks—Diversified", 75.2, 248, { exchange: "NYSE", dividendYield: 0.0213, peRatio: 13.4, beta: 1.16, optionable: true, vol: 0.26 }),
  S("GS", "Goldman Sachs Group", "Financials", "Capital Markets", 588.4, 184, { exchange: "NYSE", dividendYield: 0.0204, peRatio: 14.6, beta: 1.35, optionable: true, vol: 0.27 }),
  S("MS", "Morgan Stanley", "Financials", "Capital Markets", 132.6, 214, { exchange: "NYSE", dividendYield: 0.028, peRatio: 16.8, beta: 1.38, optionable: true, vol: 0.27 }),
  S("V", "Visa Inc.", "Financials", "Credit Services", 309.7, 605, { exchange: "NYSE", dividendYield: 0.0076, peRatio: 31.4, beta: 0.94, optionable: true, vol: 0.2 }),
  S("MA", "Mastercard Inc.", "Financials", "Credit Services", 528.3, 487, { exchange: "NYSE", dividendYield: 0.0057, peRatio: 38.2, beta: 1.08, optionable: true, vol: 0.21 }),
  S("AXP", "American Express", "Financials", "Credit Services", 298.2, 210, { exchange: "NYSE", dividendYield: 0.0094, peRatio: 20.4, beta: 1.22, optionable: true, vol: 0.26 }),
  S("BLK", "BlackRock Inc.", "Financials", "Asset Management", 1018.5, 152, { exchange: "NYSE", dividendYield: 0.0202, peRatio: 24.4, beta: 1.28, optionable: true, vol: 0.25 }),
  S("SCHW", "Charles Schwab", "Financials", "Capital Markets", 81.4, 145, { exchange: "NYSE", dividendYield: 0.0128, peRatio: 27.2, beta: 0.98, optionable: true, vol: 0.28 }),
  S("C", "Citigroup Inc.", "Financials", "Banks—Diversified", 71.8, 136, { exchange: "NYSE", dividendYield: 0.0295, peRatio: 11.9, beta: 1.44, optionable: true, vol: 0.29 }),

  // ── Healthcare ──
  S("UNH", "UnitedHealth Group", "Healthcare", "Healthcare Plans", 512.6, 472, { exchange: "NYSE", dividendYield: 0.0164, peRatio: 32.4, beta: 0.61, optionable: true, vol: 0.26 }),
  S("JNJ", "Johnson & Johnson", "Healthcare", "Drug Manufacturers", 152.4, 367, { exchange: "NYSE", dividendYield: 0.0325, peRatio: 14.4, beta: 0.52, optionable: true, vol: 0.16 }),
  S("LLY", "Eli Lilly & Co.", "Healthcare", "Drug Manufacturers", 778.2, 739, { exchange: "NYSE", dividendYield: 0.0077, peRatio: 66.8, beta: 0.42, optionable: true, vol: 0.3 }),
  S("PFE", "Pfizer Inc.", "Healthcare", "Drug Manufacturers", 25.8, 146, { exchange: "NYSE", dividendYield: 0.0651, peRatio: 9.2, beta: 0.62, optionable: true, vol: 0.24 }),
  S("ABBV", "AbbVie Inc.", "Healthcare", "Drug Manufacturers", 188.9, 334, { exchange: "NYSE", dividendYield: 0.0347, peRatio: 62.4, beta: 0.58, optionable: true, vol: 0.21 }),
  S("MRK", "Merck & Co.", "Healthcare", "Drug Manufacturers", 98.4, 249, { exchange: "NYSE", dividendYield: 0.033, peRatio: 15.8, beta: 0.39, optionable: true, vol: 0.2 }),
  S("TMO", "Thermo Fisher Scientific", "Healthcare", "Diagnostics & Research", 528.7, 201, { exchange: "NYSE", dividendYield: 0.0029, peRatio: 32.8, beta: 0.79, optionable: true, vol: 0.24 }),
  S("ABT", "Abbott Laboratories", "Healthcare", "Medical Devices", 114.6, 199, { exchange: "NYSE", dividendYield: 0.0206, peRatio: 23.4, beta: 0.72, optionable: true, vol: 0.18 }),

  // ── Consumer ──
  S("WMT", "Walmart Inc.", "Consumer Staples", "Discount Stores", 92.4, 742, { exchange: "NYSE", dividendYield: 0.0091, peRatio: 38.6, beta: 0.51, optionable: true, vol: 0.2 }),
  S("COST", "Costco Wholesale", "Consumer Staples", "Discount Stores", 924.8, 410, { dividendYield: 0.005, peRatio: 55.2, beta: 0.78, optionable: true, vol: 0.21 }),
  S("PG", "Procter & Gamble", "Consumer Staples", "Household Products", 165.2, 389, { exchange: "NYSE", dividendYield: 0.0244, peRatio: 26.8, beta: 0.41, optionable: true, vol: 0.15 }),
  S("KO", "Coca-Cola Co.", "Consumer Staples", "Beverages—Non-Alcoholic", 68.9, 297, { exchange: "NYSE", dividendYield: 0.0281, peRatio: 24.6, beta: 0.59, optionable: true, vol: 0.14 }),
  S("PEP", "PepsiCo Inc.", "Consumer Staples", "Beverages—Non-Alcoholic", 132.4, 182, { dividendYield: 0.0409, peRatio: 19.4, beta: 0.53, optionable: true, vol: 0.15 }),
  S("HD", "Home Depot", "Consumer Discretionary", "Home Improvement Retail", 412.6, 409, { exchange: "NYSE", dividendYield: 0.0218, peRatio: 27.8, beta: 1.02, optionable: true, vol: 0.22 }),
  S("MCD", "McDonald's Corp.", "Consumer Discretionary", "Restaurants", 288.4, 206, { exchange: "NYSE", dividendYield: 0.0231, peRatio: 25.2, beta: 0.71, optionable: true, vol: 0.18 }),
  S("NKE", "Nike Inc.", "Consumer Discretionary", "Footwear & Accessories", 72.8, 108, { exchange: "NYSE", dividendYield: 0.022, peRatio: 21.2, beta: 1.05, optionable: true, vol: 0.3 }),
  S("SBUX", "Starbucks Corp.", "Consumer Discretionary", "Restaurants", 98.2, 111, { dividendYield: 0.0248, peRatio: 26.8, beta: 0.97, optionable: true, vol: 0.26 }),
  S("DIS", "Walt Disney Co.", "Communication Services", "Entertainment", 112.4, 203, { exchange: "NYSE", dividendYield: 0.008, peRatio: 41.8, beta: 1.4, optionable: true, vol: 0.27 }),
  S("NFLX", "Netflix Inc.", "Communication Services", "Entertainment", 918.6, 393, { peRatio: 45.8, beta: 1.28, optionable: true, vol: 0.34 }),

  // ── Industrials / Energy / other sectors ──
  S("XOM", "Exxon Mobil Corp.", "Energy", "Oil & Gas Integrated", 118.4, 524, { exchange: "NYSE", dividendYield: 0.0334, peRatio: 13.8, beta: 0.61, optionable: true, vol: 0.24 }),
  S("CVX", "Chevron Corp.", "Energy", "Oil & Gas Integrated", 156.8, 281, { exchange: "NYSE", dividendYield: 0.0417, peRatio: 15.6, beta: 1.08, optionable: true, vol: 0.23 }),
  S("COP", "ConocoPhillips", "Energy", "Oil & Gas E&P", 98.2, 115, { exchange: "NYSE", dividendYield: 0.0318, peRatio: 12.4, beta: 1.18, optionable: true, vol: 0.29 }),
  S("SLB", "SLB Ltd.", "Energy", "Oil & Gas Equipment & Services", 38.4, 54, { exchange: "NYSE", dividendYield: 0.0297, peRatio: 12.2, beta: 1.52, optionable: true, vol: 0.32 }),
  S("BA", "Boeing Co.", "Industrials", "Aerospace & Defense", 178.6, 134, { exchange: "NYSE", peRatio: null as never, beta: 1.54, optionable: true, vol: 0.36 }),
  S("CAT", "Caterpillar Inc.", "Industrials", "Farm & Heavy Machinery", 382.4, 185, { exchange: "NYSE", dividendYield: 0.0147, peRatio: 17.6, beta: 1.09, optionable: true, vol: 0.26 }),
  S("GE", "GE Aerospace", "Industrials", "Aerospace & Defense", 188.9, 203, { exchange: "NYSE", dividendYield: 0.0076, peRatio: 34.2, beta: 1.18, optionable: true, vol: 0.3 }),
  S("HON", "Honeywell Intl.", "Industrials", "Conglomerates", 212.6, 138, { dividendYield: 0.0212, peRatio: 24.4, beta: 1.04, optionable: true, vol: 0.2 }),
  S("UPS", "United Parcel Service", "Industrials", "Integrated Freight", 128.4, 110, { exchange: "NYSE", dividendYield: 0.051, peRatio: 17.8, beta: 1.02, optionable: true, vol: 0.26 }),
  S("RTX", "RTX Corp.", "Industrials", "Aerospace & Defense", 128.6, 171, { exchange: "NYSE", dividendYield: 0.0196, peRatio: 36.8, beta: 0.82, optionable: true, vol: 0.2 }),
  S("LMT", "Lockheed Martin", "Industrials", "Aerospace & Defense", 468.2, 111, { exchange: "NYSE", dividendYield: 0.0282, peRatio: 17.2, beta: 0.48, optionable: true, vol: 0.19 }),
  S("DE", "Deere & Co.", "Industrials", "Farm & Heavy Machinery", 468.4, 128, { exchange: "NYSE", dividendYield: 0.0138, peRatio: 18.4, beta: 1.0, optionable: true, vol: 0.26 }),
  S("NEE", "NextEra Energy", "Utilities", "Utilities—Regulated Electric", 72.4, 149, { exchange: "NYSE", dividendYield: 0.0312, peRatio: 21.6, beta: 0.54, optionable: true, vol: 0.22 }),
  S("SO", "Southern Co.", "Utilities", "Utilities—Regulated Electric", 88.6, 97, { exchange: "NYSE", dividendYield: 0.0325, peRatio: 20.8, beta: 0.51, optionable: true, vol: 0.16 }),
  S("DUK", "Duke Energy", "Utilities", "Utilities—Regulated Electric", 112.4, 87, { exchange: "NYSE", dividendYield: 0.0371, peRatio: 19.4, beta: 0.48, optionable: true, vol: 0.15 }),
  S("LIN", "Linde plc", "Materials", "Specialty Chemicals", 452.6, 216, { dividendYield: 0.0123, peRatio: 33.8, beta: 0.94, optionable: true, vol: 0.19 }),
  S("FCX", "Freeport-McMoRan", "Materials", "Copper", 42.8, 61, { exchange: "NYSE", dividendYield: 0.014, peRatio: 31.2, beta: 1.88, optionable: true, vol: 0.42 }),
  S("NEM", "Newmont Corp.", "Materials", "Gold", 52.4, 60, { exchange: "NYSE", dividendYield: 0.0191, peRatio: 15.2, beta: 0.48, optionable: true, vol: 0.34 }),
  S("AMT", "American Tower", "Real Estate", "REIT—Specialty", 188.4, 88, { exchange: "NYSE", dividendYield: 0.0345, peRatio: 38.4, beta: 0.88, optionable: true, vol: 0.24 }),
  S("PLD", "Prologis Inc.", "Real Estate", "REIT—Industrial", 112.6, 104, { exchange: "NYSE", dividendYield: 0.0341, peRatio: 35.6, beta: 1.06, optionable: true, vol: 0.25 }),
  S("O", "Realty Income", "Real Estate", "REIT—Retail", 58.4, 51, { exchange: "NYSE", dividendYield: 0.0547, peRatio: 42.8, beta: 0.96, optionable: true, vol: 0.19 }),

  // ── Growth / mid-caps (screener variety) ──
  S("SHOP", "Shopify Inc.", "Technology", "Software—Application", 112.4, 145, { peRatio: 74.2, beta: 2.24, optionable: true, vol: 0.45, country: "CA", exchange: "NYSE" }),
  S("XYZ", "Block Inc.", "Technology", "Software—Infrastructure", 88.6, 55, { peRatio: 62.4, beta: 2.48, optionable: true, vol: 0.52 }),
  S("UBER", "Uber Technologies", "Technology", "Software—Application", 72.4, 151, { exchange: "NYSE", peRatio: 32.4, beta: 1.36, optionable: true, vol: 0.38 }),
  S("ABNB", "Airbnb Inc.", "Consumer Discretionary", "Travel Services", 128.6, 81, { peRatio: 34.8, beta: 1.14, optionable: true, vol: 0.36 }),
  S("COIN", "Coinbase Global", "Financials", "Capital Markets", 262.4, 65, { peRatio: 48.6, beta: 3.32, optionable: true, vol: 0.72 }),
  S("SNOW", "Snowflake Inc.", "Technology", "Software—Application", 168.2, 56, { peRatio: null as never, beta: 0.94, optionable: true, vol: 0.48 }),
  S("CRWD", "CrowdStrike Holdings", "Technology", "Software—Infrastructure", 388.4, 96, { peRatio: 92.4, beta: 1.12, optionable: true, vol: 0.45 }),
  S("DKNG", "DraftKings Inc.", "Consumer Discretionary", "Gambling", 38.6, 19, { peRatio: null as never, beta: 1.88, optionable: true, vol: 0.55 }),
  S("RIVN", "Rivian Automotive", "Consumer Discretionary", "Auto Manufacturers", 12.4, 14, { peRatio: null as never, beta: 2.02, optionable: true, vol: 0.68 }),
  S("SOFI", "SoFi Technologies", "Financials", "Credit Services", 14.8, 16, { peRatio: 58.4, beta: 1.62, optionable: true, vol: 0.58 }),
  S("SMCI", "Super Micro Computer", "Technology", "Computer Hardware", 32.6, 19, { peRatio: 16.2, beta: 1.42, optionable: true, vol: 0.75 }),

  // ── ETFs ──
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Broad Market", industry: "Index ETF", basePrice: 585.2, marketCap: 590e9, dividendYield: 0.0124, beta: 1.0, optionable: true, vol: 0.15, description: "Tracks the S&P 500 Index of large-cap US equities." },
  { symbol: "QQQ", name: "Invesco QQQ Trust", assetClass: "ETF", exchange: "NASDAQ", currency: "USD", sector: "Broad Market", industry: "Index ETF", basePrice: 512.4, marketCap: 295e9, dividendYield: 0.0055, beta: 1.18, optionable: true, vol: 0.2, description: "Tracks the Nasdaq-100 Index of large non-financial companies." },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Broad Market", industry: "Index ETF", basePrice: 228.6, marketCap: 68e9, dividendYield: 0.0132, beta: 1.24, optionable: true, vol: 0.21 },
  { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Broad Market", industry: "Index ETF", basePrice: 428.4, marketCap: 36e9, dividendYield: 0.0172, beta: 0.92, optionable: true, vol: 0.13 },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Broad Market", industry: "Index ETF", basePrice: 288.2, marketCap: 420e9, dividendYield: 0.0131, beta: 1.0, optionable: true, vol: 0.15 },
  { symbol: "XLF", name: "Financial Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Financials", industry: "Sector ETF", basePrice: 48.6, marketCap: 42e9, optionable: true, vol: 0.18 },
  { symbol: "XLK", name: "Technology Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Technology", industry: "Sector ETF", basePrice: 228.4, marketCap: 72e9, optionable: true, vol: 0.21 },
  { symbol: "XLE", name: "Energy Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Energy", industry: "Sector ETF", basePrice: 88.2, marketCap: 32e9, optionable: true, vol: 0.24 },
  { symbol: "XLV", name: "Health Care Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Healthcare", industry: "Sector ETF", basePrice: 148.6, marketCap: 38e9, optionable: true, vol: 0.14 },
  { symbol: "XLI", name: "Industrial Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Industrials", industry: "Sector ETF", basePrice: 138.4, marketCap: 22e9, optionable: true, vol: 0.16 },
  { symbol: "XLP", name: "Consumer Staples Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Consumer Staples", industry: "Sector ETF", basePrice: 78.6, marketCap: 16e9, optionable: true, vol: 0.12 },
  { symbol: "XLY", name: "Consumer Discretionary Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Consumer Discretionary", industry: "Sector ETF", basePrice: 218.2, marketCap: 20e9, optionable: true, vol: 0.18 },
  { symbol: "XLU", name: "Utilities Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Utilities", industry: "Sector ETF", basePrice: 78.4, marketCap: 18e9, optionable: true, vol: 0.16 },
  { symbol: "XLC", name: "Communication Services Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Communication Services", industry: "Sector ETF", basePrice: 98.6, marketCap: 22e9, optionable: true, vol: 0.19 },
  { symbol: "XLRE", name: "Real Estate Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Real Estate", industry: "Sector ETF", basePrice: 42.8, marketCap: 8e9, optionable: true, vol: 0.2 },
  { symbol: "XLB", name: "Materials Select Sector SPDR", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Materials", industry: "Sector ETF", basePrice: 88.4, marketCap: 6e9, optionable: true, vol: 0.2 },
  { symbol: "GLD", name: "SPDR Gold Shares", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Commodities", industry: "Commodity ETF", basePrice: 268.4, marketCap: 78e9, optionable: true, vol: 0.15, description: "Tracks the price of gold bullion." },
  { symbol: "SLV", name: "iShares Silver Trust", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Commodities", industry: "Commodity ETF", basePrice: 32.6, marketCap: 15e9, optionable: true, vol: 0.28 },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", assetClass: "ETF", exchange: "NASDAQ", currency: "USD", sector: "Fixed Income", industry: "Bond ETF", basePrice: 88.6, marketCap: 48e9, dividendYield: 0.0438, optionable: true, vol: 0.14 },
  { symbol: "HYG", name: "iShares iBoxx High Yield Corporate Bond ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Fixed Income", industry: "Bond ETF", basePrice: 78.8, marketCap: 16e9, dividendYield: 0.0582, optionable: true, vol: 0.08 },
  { symbol: "AGG", name: "iShares Core US Aggregate Bond ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Fixed Income", industry: "Bond ETF", basePrice: 98.4, marketCap: 118e9, dividendYield: 0.0362, optionable: false, vol: 0.06 },
  { symbol: "EEM", name: "iShares MSCI Emerging Markets ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "International", industry: "Index ETF", basePrice: 44.2, marketCap: 18e9, optionable: true, vol: 0.18 },
  { symbol: "ARKK", name: "ARK Innovation ETF", assetClass: "ETF", exchange: "NYSE Arca", currency: "USD", sector: "Thematic", industry: "Active ETF", basePrice: 52.8, marketCap: 6e9, optionable: true, vol: 0.48 },

  // ── Indexes (not directly tradable) ──
  { symbol: "SPX", name: "S&P 500 Index", assetClass: "INDEX", exchange: "CBOE", currency: "USD", basePrice: 5850, vol: 0.15, description: "Market-cap weighted index of 500 large US companies." },
  { symbol: "NDX", name: "Nasdaq-100 Index", assetClass: "INDEX", exchange: "NASDAQ", currency: "USD", basePrice: 20850, vol: 0.2 },
  { symbol: "DJI", name: "Dow Jones Industrial Average", assetClass: "INDEX", exchange: "DJ", currency: "USD", basePrice: 43850, vol: 0.13 },
  { symbol: "RUT", name: "Russell 2000 Index", assetClass: "INDEX", exchange: "FTSE Russell", currency: "USD", basePrice: 2320, vol: 0.21 },
  { symbol: "VIX", name: "CBOE Volatility Index", assetClass: "INDEX", exchange: "CBOE", currency: "USD", basePrice: 16.8, vol: 0.9, description: "Implied 30-day volatility of S&P 500 index options." },
  { symbol: "FTSE", name: "FTSE 100 Index", assetClass: "INDEX", exchange: "LSE", currency: "GBP", basePrice: 8280, vol: 0.13, country: "GB" },
  { symbol: "DAX", name: "DAX Index", assetClass: "INDEX", exchange: "XETRA", currency: "EUR", basePrice: 19850, vol: 0.16, country: "DE" },
  { symbol: "N225", name: "Nikkei 225", assetClass: "INDEX", exchange: "TSE", currency: "JPY", basePrice: 39850, vol: 0.19, country: "JP" },
  { symbol: "HSI", name: "Hang Seng Index", assetClass: "INDEX", exchange: "HKEX", currency: "HKD", basePrice: 19850, vol: 0.22, country: "HK" },

  // ── Crypto (24/7) ──
  { symbol: "BTC", name: "Bitcoin / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 97850, marketCap: 1930e9, vol: 0.55, description: "Decentralized proof-of-work digital asset; supply capped at 21 million." },
  { symbol: "ETH", name: "Ethereum / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 3420, marketCap: 412e9, vol: 0.68, description: "Smart-contract platform and proof-of-stake network." },
  { symbol: "SOL", name: "Solana / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 218.5, marketCap: 104e9, vol: 0.85 },
  { symbol: "XRP", name: "XRP / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 2.42, marketCap: 138e9, vol: 0.8 },
  { symbol: "DOGE", name: "Dogecoin / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 0.32, marketCap: 47e9, vol: 0.95 },
  { symbol: "ADA", name: "Cardano / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 0.98, marketCap: 35e9, vol: 0.78 },
  { symbol: "AVAX", name: "Avalanche / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 38.5, marketCap: 16e9, vol: 0.82 },
  { symbol: "LINK", name: "Chainlink / USD", assetClass: "CRYPTO", exchange: "Crypto", currency: "USD", basePrice: 22.4, marketCap: 14e9, vol: 0.8 },

  // ── FX pairs ──
  { symbol: "EURUSD", name: "Euro / US Dollar", assetClass: "FX", exchange: "FX", currency: "USD", basePrice: 1.0842, vol: 0.07 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "FX", exchange: "FX", currency: "USD", basePrice: 1.2685, vol: 0.08 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", assetClass: "FX", exchange: "FX", currency: "JPY", basePrice: 154.85, vol: 0.1 },
  { symbol: "USDCHF", name: "US Dollar / Swiss Franc", assetClass: "FX", exchange: "FX", currency: "CHF", basePrice: 0.8842, vol: 0.07 },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "FX", exchange: "FX", currency: "USD", basePrice: 0.6485, vol: 0.09 },
  { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", assetClass: "FX", exchange: "FX", currency: "CAD", basePrice: 1.4285, vol: 0.07 },
  { symbol: "DXY", name: "US Dollar Index", assetClass: "INDEX", exchange: "ICE", currency: "USD", basePrice: 106.8, vol: 0.06, description: "Trade-weighted value of the US dollar against six major currencies." },

  // ── Commodities (front-month proxies) ──
  { symbol: "CL", name: "WTI Crude Oil (front month)", assetClass: "FUTURE", exchange: "NYMEX", currency: "USD", basePrice: 72.4, vol: 0.32, description: "West Texas Intermediate crude oil futures." },
  { symbol: "NG", name: "Natural Gas (front month)", assetClass: "FUTURE", exchange: "NYMEX", currency: "USD", basePrice: 3.42, vol: 0.55 },
  { symbol: "GC", name: "Gold (front month)", assetClass: "FUTURE", exchange: "COMEX", currency: "USD", basePrice: 2892, vol: 0.14 },
  { symbol: "SI", name: "Silver (front month)", assetClass: "FUTURE", exchange: "COMEX", currency: "USD", basePrice: 35.2, vol: 0.28 },
  { symbol: "HG", name: "Copper (front month)", assetClass: "FUTURE", exchange: "COMEX", currency: "USD", basePrice: 4.28, vol: 0.24 },
  { symbol: "ZW", name: "Wheat (front month)", assetClass: "FUTURE", exchange: "CBOT", currency: "USD", basePrice: 585, vol: 0.26 },
];

export const UNIVERSE_MAP = new Map(UNIVERSE.map((u) => [u.symbol, u]));

export function lookup(symbol: string): UniverseEntry | undefined {
  return UNIVERSE_MAP.get(symbol.toUpperCase());
}

export const SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLY", "XLC", "XLU", "XLRE", "XLB"];
