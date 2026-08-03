// Article extractor — returns a clean reader version of a news URL.
// Primary: r.jina.ai reader proxy (handles JS-rendered pages like CNBC).
// Fallback: direct fetch + hand-rolled extraction. Some sources
// (Investing.com) block all extraction — the UI falls back to the RSS
// summary plus an external link. Cached 1h per URL.

import { ProviderError } from "./providers/errors";

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const TIMEOUT_MS = 20_000;
const MAX_HTML = 1_500_000;

export interface ArticleContent {
  title: string;
  siteName: string;
  paragraphs: string[];
}

const cache = new Map<string, { value: ArticleContent; expires: number }>();

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, c: string) => String.fromCodePoint(parseInt(c, 16) || 32))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const BOILERPLATE =
  /^(subscribe|sign up|log in|advertisement|copyright|©|all rights reserved|read more|related:|see also|share this|follow us|cookie|privacy policy|terms of|newsletter|download the app|watch:|photo:|file photo|disclosure|disclaimer|skip navigation)/i;

/** Strip markdown link/image syntax, keeping the visible text. */
function demarkdown(s: string): string {
  return decodeEntities(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** A line that is only links/bullets/navigation, not prose. */
function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[\s*#>\-]+$/.test(t)) return true;
  const withoutLinks = t.replace(/!?\[[^\]]*\]\([^)]*\)/g, "").trim();
  if (withoutLinks.length < 40) return true; // headings, link-only lines, captions
  return false;
}

function parseJina(text: string, host: string): ArticleContent {
  const title = /^Title:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
  const body = text.split(/^Markdown Content:\s*$/m)[1] ?? text;
  const paragraphs: string[] = [];
  for (const line of body.split("\n")) {
    if (isJunkLine(line)) continue;
    const t = demarkdown(line.replace(/^\*+\s+/, ""));
    if (t.length < 40 || BOILERPLATE.test(t)) continue;
    paragraphs.push(t);
  }
  if (paragraphs.length === 0) throw new ProviderError("Could not extract article text", "upstream");
  return { title: (title || host).slice(0, 200), siteName: host.replace(/^www\./, ""), paragraphs: paragraphs.slice(0, 60) };
}

function dropTags(html: string): string {
  return html
    .replace(/<(script|style|noscript|iframe|svg|form|button|select|header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function paragraphsFrom(html: string): string[] {
  const out: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = textOf(m[1] ?? "");
    if (t.length < 40 || BOILERPLATE.test(t)) continue;
    out.push(t);
  }
  return out;
}

async function viaDirect(url: string, host: string): Promise<ArticleContent> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new ProviderError(`Article HTTP ${res.status}`, "upstream");
  let html = await res.text();
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
  const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const cleaned = dropTags(html);
  const articleMatch = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned) ?? /<main[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned);
  let paragraphs = paragraphsFrom(articleMatch?.[1] ?? cleaned);
  if (paragraphs.length < 3 && articleMatch) paragraphs = paragraphsFrom(cleaned);
  if (paragraphs.length === 0) throw new ProviderError("Could not extract article text (site may block readers)", "upstream");
  return { title: title.slice(0, 200), siteName: host.replace(/^www\./, ""), paragraphs: paragraphs.slice(0, 60) };
}

export async function getArticle(url: string): Promise<ArticleContent> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError("Invalid article URL", "not_found");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderError("Only http(s) articles supported", "not_found");
  }
  const host = parsed.hostname;
  if (/^(\d+\.){3}\d+$/.test(host) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ProviderError("Host not allowed", "not_found");
  }

  let value: ArticleContent | null = null;
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": UA, Accept: "text/plain" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const text = await res.text();
      // jina returns JSON errors with 200 sometimes
      if (!text.startsWith("{")) value = parseJina(text, host);
    }
  } catch { /* fall through to direct */ }
  if (!value) value = await viaDirect(url, host);

  cache.set(url, { value, expires: Date.now() + 3_600_000 });
  return value;
}
