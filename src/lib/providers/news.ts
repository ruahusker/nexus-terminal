// RSS news aggregator adapter (free, no API keys, server-side only).
// Sources: Yahoo Finance (per-symbol + broad-market proxy), CNBC, MarketWatch.
// All feeds are public RSS 2.0 / Atom endpoints verified live 200 OK.

import type { NewsItem } from "../types";

export { ProviderError } from "./errors";
import { ProviderError } from "./errors";

const UA = "Mozilla/5.0 (X11; Linux x86_64) NEXUS-Terminal/1.0";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes per feed URL
const DEFAULT_LIMIT = 40;

interface FeedDef {
  url: string;
  source: string;
}

const yahooSymbolFeed = (symbol: string): FeedDef => ({
  url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
  source: "Yahoo Finance",
});

const GENERAL_FEEDS: FeedDef[] = [
  { url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", source: "CNBC Markets" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse", source: "MarketWatch" },
  { url: "https://www.investing.com/rss/news_25.rss", source: "Investing.com" },
];

// ─── tiny RSS/Atom parser ────────────────────────────────────────────────────
// These feeds are well-known and stable, so a careful regex parser over
// <item>/<entry> blocks is sufficient — no external XML dependency needed.

interface RawEntry {
  title: string;
  link: string;
  publishedAt: Date;
  description: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // &amp; last so we don't double-decode
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract text content of a tag, tolerating namespace prefixes (dc:date) and CDATA. */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "i");
  const m = re.exec(block);
  if (!m || m[1] === undefined) return "";
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

/** Atom links are <link href="..."/>; RSS links are <link>url</link>. */
function linkText(block: string): string {
  const atom = /<link[^>]*\shref="([^"]+)"/i.exec(block);
  if (atom && atom[1] !== undefined) return decodeEntities(atom[1].trim());
  return tagText(block, "link");
}

function parseDate(block: string, fallback: Date): Date {
  const raw = tagText(block, "pubDate") || tagText(block, "published") || tagText(block, "date") || tagText(block, "updated");
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseFeed(xml: string, fetchedAt: Date): RawEntry[] {
  const entries: RawEntry[] = [];
  const blockRe = /<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0];
    const title = stripHtml(tagText(block, "title"));
    const link = linkText(block);
    if (!title || !link) continue;
    entries.push({
      title,
      link,
      publishedAt: parseDate(block, fetchedAt),
      description: stripHtml(tagText(block, "description") || tagText(block, "summary") || tagText(block, "content")),
    });
  }
  return entries;
}

/** Stable sha1-ish id: simple string hash rendered in base36. */
function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(h, 31) + input.charCodeAt(i)) | 0;
  }
  return `rss_${(h >>> 0).toString(36)}`;
}

// ─── per-feed fetch + cache ──────────────────────────────────────────────────

const feedCache = new Map<string, { at: number; entries: RawEntry[] }>();

async function fetchFeed(feed: FeedDef): Promise<RawEntry[]> {
  const cached = feedCache.get(feed.url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;

  const res = await fetch(feed.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new ProviderError(`${feed.source} RSS HTTP ${res.status}`, "upstream");
  const xml = await res.text();
  const fetchedAt = new Date();
  const entries = parseFeed(xml, fetchedAt);
  feedCache.set(feed.url, { at: Date.now(), entries });
  return entries;
}

/** Dedupe key: normalized headline (lowercase, punctuation stripped, first 8 words). */
function dedupeKey(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

// ─── public adapter ──────────────────────────────────────────────────────────

export const rssNews = {
  isConfigured(): true {
    return true; // no keys required
  },

  async getNews(opts: { symbol?: string; topic?: string; q?: string; limit?: number }): Promise<NewsItem[]> {
    const symbol = opts.symbol?.toUpperCase();
    const limit = opts.limit ?? DEFAULT_LIMIT;

    const jobs: { feed: FeedDef; symbols: string[] }[] = symbol
      ? [{ feed: yahooSymbolFeed(symbol), symbols: [symbol] }]
      : GENERAL_FEEDS.map((feed) => ({ feed, symbols: [] as string[] }));

    const settled = await Promise.allSettled(jobs.map((j) => fetchFeed(j.feed)));

    const items: NewsItem[] = [];
    let failures = 0;
    const fetchedAtIso = new Date().toISOString();
    settled.forEach((result, i) => {
      const job = jobs[i];
      if (!job) return;
      if (result.status === "rejected") {
        failures++; // one failing feed must not kill the others
        return;
      }
      for (const e of result.value) {
        items.push({
          provider: "rss",
          status: "REALTIME",
          asOf: fetchedAtIso,
          id: hashId(e.link),
          headline: e.title,
          summary: e.description.slice(0, 500),
          source: job.feed.source,
          url: e.link,
          symbols: job.symbols,
          topics: [], // these RSS feeds carry no topic metadata — none invented
          publishedAt: e.publishedAt.toISOString(),
          sample: false,
        });
      }
    });

    if (failures === jobs.length) {
      throw new ProviderError("All RSS feeds failed", "upstream");
    }

    // Dedupe by normalized headline, keeping the earliest-published copy.
    const seen = new Map<string, NewsItem>();
    for (const item of items) {
      const key = dedupeKey(item.headline);
      const prev = seen.get(key);
      if (!prev || item.publishedAt < prev.publishedAt) seen.set(key, item);
    }
    let out = [...seen.values()];

    // Note: topics are always [] (feeds lack topic metadata), so opts.topic
    // intentionally does NOT filter — there is nothing to match against.
    if (opts.q) {
      const q = opts.q.toLowerCase();
      out = out.filter((n) => n.headline.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q));
    }

    out.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
    return out.slice(0, limit);
  },
};
