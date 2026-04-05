import { DEFAULT_BLOCKED_EXTENSIONS } from "./types";

/**
 * Normalize a URL: strip fragment, remove trailing slash.
 * NOTE: new URL() already lowercases hostname per WHATWG spec.
 */
export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    let href = parsed.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return raw;
  }
}

/** Extract hostname from a URL */
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Check if two URLs share the same hostname */
export function isSameDomain(url: string, seedDomain: string): boolean {
  try {
    return new URL(url).hostname === seedDomain;
  } catch {
    return false;
  }
}

/** Check if URL has a blocked file extension */
export function isBlockedExtension(
  url: string,
  blocked: Set<string> = DEFAULT_BLOCKED_EXTENSIONS,
): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const lastSegment = pathname.split("/").pop() || "";
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex === -1) return false;
    const ext = lastSegment.substring(dotIndex);
    return blocked.has(ext);
  } catch {
    return false;
  }
}

/** Resolve a possibly-relative href against a base URL */
export function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Detect href values that are effectively empty/whitespace-only after decoding.
 * This filters malformed links like "%20" or "/%20" that should not become crawlable URLs.
 */
export function isWhitespaceOnlyHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return true;

  try {
    return decodeURIComponent(trimmed).replace(/[\/?#&=]+/g, " ").trim() === "";
  } catch {
    return false;
  }
}

/** Check if a content-type header indicates HTML */
export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return ct === "text/html" || ct === "application/xhtml+xml";
}

/** Check if a hostname points to a private/reserved network (SSRF protection) */
export function isPrivateHostname(hostname: string): boolean {
  // IPv4 loopback
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  // IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") return true;

  // Private IPv4 ranges
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  // Link-local
  if (/^169\.254\./.test(hostname)) return true;
  // Carrier-grade NAT
  if (/^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./.test(hostname)) return true;

  // .local, .internal, .localhost mDNS/reserved TLDs
  if (/\.(local|internal|localhost|localhost\.localdomain)$/.test(hostname))
    return true;

  return false;
}

/** Validate URL is safe to fetch (non-private, HTTP/HTTPS only) */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}
