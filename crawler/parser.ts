import * as cheerio from "cheerio";
import type { FetchResult, ParsedResult } from "./types";
import {
  normalizeUrl,
  getDomain,
  isWhitespaceOnlyHref,
  resolveUrl,
} from "./url-utils";

/**
 * Parse HTML content with Cheerio. Extracts SEO metadata and links.
 */
export function parseHtml(
  result: FetchResult,
  depth: number,
  seedDomain: string,
): ParsedResult {
  const $ = cheerio.load(result.html);

  const title = $("title").first().text().trim() || null;

  const canonicalRaw = $('link[rel="canonical"]').first().attr("href") || null;
  const canonical = canonicalRaw ? resolveUrl(canonicalRaw, result.url) : null;

  const metaRobots =
    $('meta[name="robots" i]').first().attr("content")?.trim() || null;

  const internalLinks: string[] = [];
  const externalLinks: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || isWhitespaceOnlyHref(href)) return;

    // Skip non-HTTP protocols
    if (
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href === "#"
    ) {
      return;
    }

    const absolute = resolveUrl(href, result.url);
    if (!absolute) return;

    const normalized = normalizeUrl(absolute);

    if (getDomain(normalized) === seedDomain) {
      internalLinks.push(normalized);
    } else {
      externalLinks.push(normalized);
    }
  });

  // Extract <html lang="...">
  const lang = $("html").attr("lang")?.trim() || null;

  // Extract <link rel="alternate" hreflang="...">
  const hreflang: { lang: string; href: string }[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const hreflangCode = $(el).attr("hreflang")?.trim();
    const hrefRaw = $(el).attr("href");
    if (hreflangCode && hrefRaw && !isWhitespaceOnlyHref(hrefRaw)) {
      const resolved = resolveUrl(hrefRaw, result.url);
      if (resolved) {
        hreflang.push({ lang: hreflangCode, href: resolved });
      }
    }
  });

  return {
    url: result.url,
    status: result.status,
    contentType: result.contentType,
    depth,
    title,
    canonical,
    metaRobots,
    lang,
    hreflang,
    internalLinks: [...new Set(internalLinks)],
    externalLinks: [...new Set(externalLinks)],
  };
}

/**
 * Check if a page is indexable based on meta robots directives.
 * A page is indexable unless it contains noindex or none.
 */
export function isIndexable(metaRobots: string | null): boolean {
  if (!metaRobots) return true;
  const lower = metaRobots.toLowerCase();
  return !lower.includes("noindex") && !lower.includes("none");
}
