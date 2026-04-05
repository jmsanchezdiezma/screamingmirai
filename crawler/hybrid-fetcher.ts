import { fetchPage } from "./fetcher";
import { fetchWithPlaywright } from "./playwright";
import type { FetchResult } from "./types";

export interface HybridFetchResult extends FetchResult {
  method: "cheerio" | "playwright";
}

/**
 * Lightweight heuristic: detect if a page likely needs JS rendering.
 * Uses regex instead of Cheerio to avoid double-parsing.
 */
function needsJsRendering(html: string): boolean {
  // Extract text content between body tags
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, "") : html.replace(/<[^>]+>/g, "");
  const textLength = bodyContent.trim().length;

  // Very short body content suggests JS rendering needed
  if (textLength < 100) return true;

  // Common SPA root containers with no child elements
  const emptySpaRoots = [
    '<div id="root"></div>',
    '<div id="root"/>',
    '<div id="__next"></div>',
    '<div id="__next"/>',
    '<div id="app"></div>',
    '<div id="app"/>',
    '<div id="__nuxt"></div>',
    '<div id="__nuxt"/>',
  ];
  for (const empty of emptySpaRoots) {
    if (html.includes(empty)) return true;
  }

  return false;
}

/**
 * Unified fetcher: tries fast Cheerio fetch first,
 * falls back to Playwright for JS-rendered pages.
 */
export async function hybridFetch(
  url: string,
  userAgent: string = "ScreamingWeb/1.0",
  options: { forceJs?: boolean; timeout?: number } = {},
): Promise<HybridFetchResult | null> {
  const { forceJs = false, timeout } = options;

  // Fast path: try Cheerio first unless forceJs is set
  if (!forceJs) {
    const cheerioResult = await fetchPage(url, userAgent);
    if (cheerioResult) {
      if (!needsJsRendering(cheerioResult.html)) {
        return { ...cheerioResult, method: "cheerio" };
      }
    }
  }

  // Slow path: Playwright fallback
  const pwResult = await fetchWithPlaywright(url, timeout);
  if (pwResult) {
    return { ...pwResult, url, method: "playwright" };
  }

  return null;
}
