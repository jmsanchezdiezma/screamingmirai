import type { FetchResult } from "./types";
import { isHtmlContentType } from "./url-utils";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = "ScreamingWeb/1.0";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Fetch a URL and return HTML content. Only returns HTML responses.
 * Skips non-HTML content-types to save bandwidth.
 */
export async function fetchPage(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchResult | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";

    // Only process HTML responses (single source of truth)
    if (!isHtmlContentType(contentType)) {
      return null;
    }

    // Check content-length before reading body (H4 — OOM prevention)
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return null;
    }

    const html = await response.text();

    return {
      html,
      status: response.status,
      contentType,
      url: response.url, // follows redirects
    };
  } catch {
    return null;
  }
}
