// SEC EDGAR filings adapter (free, no API key, server-side only).
// Endpoints verified live 200 OK:
//   https://www.sec.gov/files/company_tickers.json      (ticker → CIK map)
//   https://data.sec.gov/submissions/CIK##########.json (recent filings)
// SEC fair-access policy REQUIRES a descriptive User-Agent with contact info.

import type { Filing } from "../types";

export { ProviderError } from "./errors";
import { ProviderError } from "./errors";

const UA = "NEXUS Terminal contact@vibeprojects.us";
const FETCH_TIMEOUT_MS = 10_000;
const TICKERS_CACHE_TTL_MS = 24 * 60 * 60_000; // 24h
const MAX_FILINGS = 40;

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const submissionsUrl = (cik: number): string =>
  `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;

// ─── fetch with SEC-required UA, timeout, and one retry on 5xx ───────────────

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        next: { revalidate: 0 },
      });
      if (res.status >= 500 && attempt === 0) {
        lastErr = new ProviderError(`SEC EDGAR HTTP ${res.status}`, "upstream");
        continue; // one retry on 5xx
      }
      if (!res.ok) throw new ProviderError(`SEC EDGAR HTTP ${res.status}`, "upstream");
      return (await res.json()) as unknown;
    } catch (err) {
      lastErr = err;
      if (err instanceof ProviderError) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError("SEC EDGAR request failed", "upstream");
}

// ─── ticker → CIK map (cached 24h in module scope) ───────────────────────────

interface CompanyTickersFile {
  [index: string]: { cik_str: number; ticker: string; title: string };
}

let tickerMapCache: { at: number; map: Map<string, { cik: number; name: string }> } | null = null;

async function tickerMap(): Promise<Map<string, { cik: number; name: string }>> {
  if (tickerMapCache && Date.now() - tickerMapCache.at < TICKERS_CACHE_TTL_MS) return tickerMapCache.map;

  const json = (await fetchJson(TICKERS_URL)) as CompanyTickersFile;
  const map = new Map<string, { cik: number; name: string }>();
  for (const key of Object.keys(json)) {
    const row = json[key];
    if (!row || typeof row.ticker !== "string" || typeof row.cik_str !== "number") continue;
    map.set(row.ticker.toUpperCase(), { cik: row.cik_str, name: row.title ?? "" });
  }
  tickerMapCache = { at: Date.now(), map };
  return map;
}

// ─── submissions payload shape ───────────────────────────────────────────────

interface SubmissionsFile {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

// ─── public adapter ──────────────────────────────────────────────────────────

export const edgar = {
  isConfigured(): true {
    return true; // no keys required
  },

  async getFilings(symbol: string): Promise<Filing[]> {
    const sym = symbol.toUpperCase();
    const map = await tickerMap();
    const company = map.get(sym);
    if (!company) throw new ProviderError(`Unknown ticker for SEC EDGAR: ${sym}`, "not_found");

    const json = (await fetchJson(submissionsUrl(company.cik))) as SubmissionsFile;
    const recent = json.filings?.recent;
    if (!recent) return [];

    const forms = recent.form ?? [];
    const dates = recent.filingDate ?? [];
    const accessions = recent.accessionNumber ?? [];
    const docs = recent.primaryDocument ?? [];
    const descriptions = recent.primaryDocDescription ?? [];

    const filings: Filing[] = [];
    const count = Math.min(forms.length, MAX_FILINGS); // recent is already date-desc
    for (let i = 0; i < count; i++) {
      const form = forms[i];
      const accession = accessions[i];
      if (!form || !accession) continue;
      const desc = descriptions[i];
      const primaryDoc = docs[i];
      filings.push({
        id: accession,
        symbol: sym,
        type: form,
        title: desc ? `${form} — ${desc}` : `${form} filing`,
        filedAt: dates[i] ?? "",
        url: primaryDoc
          ? `https://www.sec.gov/Archives/edgar/data/${company.cik}/${accession.replace(/-/g, "")}/${primaryDoc}`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${accession}`,
        sample: false,
      });
    }
    return filings;
  },
};
