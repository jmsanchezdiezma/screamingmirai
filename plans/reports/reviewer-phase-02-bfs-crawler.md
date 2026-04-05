# Code Review: Phase 2 — BFS Crawler Module

**Reviewer:** code-reviewer
**Date:** 2026-04-04
**Scope:** `crawler/types.ts`, `crawler/url-utils.ts`, `crawler/fetcher.ts`, `crawler/parser.ts`, `crawler/bfs.ts`, `crawler/index.ts`
**LOC:** 354 total (all files under 200-line limit)
**Focus:** Type safety, URL edge cases, memory, security, async generator correctness

---

## Overall Assessment

Clean, well-structured module with clear separation of concerns. No `any` types. Each file stays focused and under 200 lines. The async generator pattern is correct. However, there are several production-relevant issues around content-type checking consistency, SSRF exposure, and silent error swallowing that should be addressed before this crawler handles real-world URLs.

---

## Critical Issues

### C1. Content-type filter mismatch between fetcher and url-utils

**Files:** `crawler/fetcher.ts:25`, `crawler/url-utils.ts:60-64`

The fetcher uses a loose `contentType.includes("text/html")` check, while `isHtmlContentType()` in url-utils uses strict equality against two specific MIME types. These can disagree.

**Impact:** A content-type like `text/html;charset=utf-8` passes both (fine), but `application/xhtml+xml` would be rejected by the fetcher even though `isHtmlContentType()` considers it valid. Conversely, something like `text/htmlz` (contrived but possible misconfiguration) would pass the fetcher's `includes()` check but fail `isHtmlContentType()`.

**Recommendation:** Use `isHtmlContentType()` in the fetcher instead of the raw `includes()` check. Single source of truth for "is this HTML?"

```ts
// fetcher.ts — replace lines 25-27
if (!isHtmlContentType(contentType)) {
  return null;
}
```

### C2. SSRF — no private network filtering

**File:** `crawler/fetcher.ts:16`

`fetchPage()` accepts any URL string and makes a server-side request with no validation. An attacker controlling the seed URL (or a page that links to `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/admin`, `http://localhost:3001/internal-api`, etc.) can trigger SSRF.

The API route in `phase-04` validates input with Zod, but the crawler itself has no defense-in-depth.

**Impact:** Cloud metadata exfiltration, internal network scanning, bypass of firewalls. This is the highest-severity security finding.

**Recommendation:** Add a `isSafeUrl()` guard in the fetcher (or in `crawlGenerator` before each fetch) that rejects:
- RFC 1918 private IPs (`10.x`, `172.16-31.x`, `192.168.x`)
- Link-local (`169.254.x.x`, `fe80::`)
- Loopback (`127.x`, `::1`, `localhost`)
- IPv6-mapped IPv4 (`::ffff:127.0.0.1`)
- File://, data:, and other non-http(s) schemes

```ts
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // DNS resolution check or hostname blocklist
    // At minimum, block known private ranges
    const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|fe80:)/i;
    return !blocked.test(parsed.hostname);
  } catch {
    return false;
  }
}
```

Note: Hostname-based blocking can be bypassed via DNS rebinding. For full protection, resolve the hostname and check the resulting IP. But hostname blocking is a reasonable first layer.

---

## High Priority Issues

### H1. `getDomain()` throws on invalid URL — no try/catch

**File:** `crawler/url-utils.ts:29-31`

`normalizeUrl()` and `isSameDomain()` both wrap `new URL()` in try/catch, but `getDomain()` does not. If called with a malformed string (which is possible — it is invoked on `config.seedUrl` in `bfs.ts:19` before any validation), it throws an unhandled exception that crashes the entire crawl.

```ts
// Current — throws on bad input
export function getDomain(url: string): string {
  return new URL(url).hostname;
}
```

**Impact:** Unhandled exception crashes crawl. Since `crawlGenerator` has no try/catch around the initial `getDomain(config.seedUrl)` call, a bad seed URL kills the generator without any cleanup.

**Recommendation:** Wrap in try/catch, return empty string on failure (or validate seed URL in `createConfig`).

```ts
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
```

### H2. Queue can grow unbounded between visited-set checks

**File:** `crawler/bfs.ts:50-58`

Internal links are added to the queue if they are not in `visited`. But a page with 500 internal links, all already in the queue but not yet visited, will add 500 duplicates. The only dedup happens when items are dequeued (line 36: `if (visited.has(normalized)) continue`).

On a site with heavy cross-linking (every page links to every other page), the queue can grow to O(pages * avg_links_per_page) before being drained. For a 10,000-page site with 100 links each, that is potentially millions of queue entries.

**Impact:** Memory spike. Not a correctness bug (dedup works), but the queue can grow 10-100x larger than necessary.

**Recommendation:** Add a `queued` set alongside `visited`:

```ts
const visited = new Set<string>();
const queued = new Set<string>([seedNormalized]);

// ... in the loop:
for (const link of parsed.internalLinks) {
  const linkNormalized = normalizeUrl(link);
  if (!visited.has(linkNormalized) && !queued.has(linkNormalized)) {
    queued.add(linkNormalized);
    queue.push({ url: linkNormalized, depth: item.depth + 1, discoveredFrom: normalized });
  }
}
// After dequeue + visit:
queued.delete(item.url); // optional — save memory on the queued set
```

### H3. `fetchPage` swallows all errors silently

**File:** `crawler/fetcher.ts:37-39`

Every error — DNS failure, connection refused, TLS errors, timeouts, redirects exceeding limits, invalid URL — is caught and returns `null`. The caller has zero visibility into *why* a page failed.

**Impact:** For an SEO crawler, knowing *why* a page failed is critical data. A 404 is different from a DNS error is different from a timeout. Currently all failures are invisible.

**Recommendation:** Return a discriminated union or at minimum log the error type:

```ts
export type FetchResult = 
  | { ok: true; html: string; status: number; contentType: string; url: string }
  | { ok: false; url: string; error: string };

// Or simpler: return FetchResult with an optional error field
```

At minimum, log the error at debug level so operators can diagnose issues.

### H4. `normalizeUrl` strips ALL trailing slashes — breaks root path

**File:** `crawler/url-utils.ts:12`

`https://example.com/` becomes `https://example.com`. This is fine for dedup purposes, but `https://example.com/dir/` becomes `https://example.com/dir`, and these may or may not be the same resource depending on server configuration. More critically, `https://example.com` (no path) and `https://example.com/` (root path) are treated identically, which is correct per HTTP semantics, but the normalized form `https://example.com` has an empty path.

If this normalized URL is later used to construct relative URLs via `resolveUrl()`, `new URL("about", "https://example.com")` resolves to `https://example.com/about` — which works. But it is worth documenting that normalization removes the path component for root URLs.

**Impact:** Low correctness risk, but worth a comment explaining the design choice. Some SEO tools intentionally keep the trailing slash for root URLs.

**Recommendation:** Add a code comment. No code change needed unless you need to distinguish root-path from no-path in SEO reports.

---

## Medium Priority Issues

### M1. `createConfig` ignores unknown properties silently

**File:** `crawler/bfs.ts:64-74`

The plan's API route passes `useJs` and `respectRobotsTxt` to `createConfig()`, but `CrawlerConfig` does not define these fields. TypeScript's `Partial<CrawlerConfig>` will not error at runtime (extra properties are ignored), but this means configuration intent is silently lost.

If the consumer writes:
```ts
createConfig({ seedUrl: url, maxDepth, maxPages, useJs, respectRobotsTxt: true })
```

The `useJs` and `respectRobotsTxt` values are silently discarded. TypeScript will catch this at compile time (good), but if the API route uses `any` or `as` casting, it will be missed.

**Recommendation:** Document that `useJs` and `respectRobotsTxt` are not yet implemented in the BFS crawler. Or add them to `CrawlerConfig` as unused fields with a TODO.

### M2. `parseHtml` does not detect or handle `<meta>` refresh redirects

**File:** `crawler/parser.ts`

An SEO crawler should detect `<meta http-equiv="refresh" content="0;url=https://example.com/new-page">` which is a common redirect mechanism. Currently, this is not extracted.

**Impact:** Missing SEO data. Meta refresh redirects are indexed by search engines and should appear in crawl results.

**Recommendation:** Add extraction in `parseHtml()`:
```ts
const metaRefresh = $('meta[http-equiv="refresh" i]').first().attr("content");
// Parse "0;url=..." pattern
```

### M3. No robots.txt checking before crawling

**File:** `crawler/bfs.ts`

The `CrawlerConfig` has no `respectRobotsTxt` field, and no code checks robots.txt before fetching. While the plan mentions this as a future feature, the current implementation will crawl pages that site owners have disallowed.

**Impact:** Ethical and legal concern. Crawling disallowed pages can result in IP blocking or legal issues. The user agent identifies as `ScreamingWeb/1.0` but does not respect the standard.

**Recommendation:** At minimum, add a `respectRobotsTxt` config option that fetches and parses `/robots.txt` before starting the crawl. Can be a follow-up phase.

### M4. `isBlockedExtension` does not handle query strings on URLs

**File:** `crawler/url-utils.ts:39`

URLs like `https://example.com/image.jpg?width=200` are handled correctly (pathname is `/image.jpg`). But URLs like `https://example.com/image.jpg?file.php` have pathname `/image.jpg` — also fine. However, `https://example.com/download.php?file=report.pdf` would check `.php`, not `.pdf`. This is actually correct behavior (the extension is `.php`), but worth noting that query-parameter-based file hints are ignored.

**Impact:** None — this is correct behavior. Just noting for completeness.

### M5. `crawlGenerator` does not yield failed pages

**File:** `crawler/bfs.ts:44`

When `fetchPage` returns `null` (network error, non-HTML content, etc.), the generator simply continues to the next item. The caller never learns that a URL was attempted but failed.

**Impact:** For an SEO crawler, knowing which URLs failed is as important as knowing which succeeded. A "pages failed" stat exists in `CrawlSession.stats` but can never be populated by the current generator.

**Recommendation:** Yield a failure result or add a callback/event mechanism for failures.

---

## Low Priority Issues

### L1. `QueueItem` interface defined but not used as a type

**File:** `crawler/types.ts:5-9`, `crawler/bfs.ts:22-26`

`QueueItem` is defined in types.ts but `bfs.ts` uses an inline anonymous type for queue items instead. Minor inconsistency.

**Recommendation:** Use the exported `QueueItem` type in `bfs.ts` for consistency.

### L2. `normalizeUrl` is called redundantly

**File:** `crawler/bfs.ts:34`

After dequeuing, `normalizeUrl(item.url)` is called again on a URL that was already normalized when it was enqueued (line 51). Double normalization is safe (idempotent), but wasteful.

**Recommendation:** Add a comment explaining that the double-normalization is intentional (defense-in-depth) or remove the redundant call.

### L3. Barrel export in index.ts is verbose

**File:** `crawler/index.ts:4`

Line 4 is a 120+ character line. Consider wrapping for readability.

### L4. `DEFAULT_BLOCKED_EXTENSIONS` does not include `.webmanifest`

**File:** `crawler/types.ts`

Web app manifests (`.webmanifest`) are non-HTML resources that a crawler should typically skip.

---

## Edge Cases Found by Scout

1. **Relative URL resolution with empty base:** If `result.url` in `parseHtml` were somehow empty or invalid, `resolveUrl(href, result.url)` would return `null` for every link. The code handles this (returns `null`, link skipped), but the root cause (empty URL) would be invisible.

2. **Self-referencing canonical loops:** `canonical` is resolved against `result.url` but not checked for circularity. Not a bug, but SEO reports should flag when canonical differs from the page URL.

3. **Very large HTML documents:** No size limit on `response.text()` in fetcher. A server could return a multi-GB response. Consider adding a `Content-Length` check or streaming with a byte limit.

4. **Concurrent access:** The async generator is designed for single-consumer use. If two consumers iterate the same generator, the queue/visited state would be corrupted. This is inherent to generators and not a bug, but worth documenting.

5. **URLs with encoded characters:** `normalizeUrl` does not normalize percent-encoding. `https://example.com/%70ath` and `https://example.com/path` are treated as different URLs. `new URL()` normalizes some encoding, but not all (e.g., `%7E` vs `~` is normalized, but `%2F` in path is not). This can cause false "duplicate" entries in crawl results.

---

## Positive Observations

1. **Clean type safety** — No `any` anywhere. All types are explicit and well-defined.
2. **Async generator pattern** — Correct implementation. The `signal.aborted` check is in the right place (top of loop). Generator `return` is used (not `throw`) for clean termination.
3. **Same-domain filtering** — Enforced both at enqueue (line 38) and at link extraction (line 45 in parser), providing defense-in-depth.
4. **Protocol filtering in parser** — Correctly skips `javascript:`, `mailto:`, `tel:`, and bare `#` hrefs.
5. **Canonical resolution** — Properly resolves relative canonical URLs against the page URL.
6. **Dedup at yield** — `internalLinks` and `externalLinks` are deduped via `[...new Set()]` before returning.
7. **File sizes** — All files well under the 200-line limit (largest is 93 lines).
8. **Barrel exports** — Clean, complete `index.ts` with both type and value exports.

---

## Metrics

| Metric | Value |
|--------|-------|
| Files Reviewed | 6 |
| Total LOC | 354 |
| Files over 200 lines | 0 |
| `any` usage | 0 |
| Type coverage | 100% (all types explicit) |
| Linting issues | 0 visible |
| Critical issues | 2 |
| High issues | 4 |
| Medium issues | 5 |
| Low issues | 4 |

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Add SSRF protection in fetcher — block private IPs and non-HTTP schemes
2. **[CRITICAL]** Align content-type check between fetcher and `isHtmlContentType()` — use the strict utility function
3. **[HIGH]** Add try/catch to `getDomain()` — prevents crash on bad seed URL
4. **[HIGH]** Add queued-set dedup in BFS to prevent unbounded queue growth on highly-connected sites
5. **[HIGH]** Return or log error information from `fetchPage` instead of swallowing all errors
6. **[HIGH]** Add response size limiting to prevent memory exhaustion on large responses
7. **[MEDIUM]** Add meta refresh redirect detection in parser
8. **[MEDIUM]** Add robots.txt support (can be a follow-up phase)
9. **[LOW]** Use `QueueItem` type in `bfs.ts` queue, add `.webmanifest` to blocked extensions

---

## Unresolved Questions

1. Should the crawler support `application/xhtml+xml` in the fetcher? The utility function does, but the fetcher does not.
2. Is the plan to add robots.txt support in a later phase, or should it be in scope for Phase 2?
3. Should `crawlGenerator` yield failure results for pages that could not be fetched, or is "skip silently" the intended behavior?
4. What is the expected maximum crawl size? The current `maxPages` default of 500 is reasonable, but the queue growth issue (H2) scales with site connectivity density.
