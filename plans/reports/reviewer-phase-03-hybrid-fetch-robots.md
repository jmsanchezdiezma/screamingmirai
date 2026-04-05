## Code Review Summary — Phase 3: Hybrid Fetch & robots.txt

### Scope
- Files: `crawler/playwright.ts`, `crawler/robots.ts`, `crawler/hybrid-fetcher.ts`, `crawler/bfs.ts`, `crawler/types.ts`, `crawler/index.ts`, `app/api/crawl/route.ts`
- LOC: ~310 (new + modified)
- Focus: Phase 3 additions — Playwright JS rendering, robots.txt compliance, hybrid fetch orchestration
- Scout findings: browser lifecycle leak, race in crawl-delay abort handling, Cheerio double-parse, Playwright HTML size unbounded

### Overall Assessment
Solid implementation. The architecture is clean — singleton browser, permissive-fallback robots, Cheerio-first with Playwright fallback. All files under 200 lines. Types are tight. However, there are several production-correctness issues: a browser process leak on long-running servers, a subtle abort-signal race in `waitForCrawlDelay`, an unnecessary Cheerio re-parse in the hybrid path, and missing response-size limits in the Playwright path.

---

### Critical Issues

#### C1. Browser process never closed between crawls — resource leak
**File:** `crawler/playwright.ts` lines 71-72, `app/api/crawl/route.ts`

`closeBrowser` is only called on SIGTERM/SIGINT. In a long-running Next.js server handling multiple sequential crawls, the Chromium process stays alive indefinitely after each crawl completes. On memory-constrained deployments this will eventually OOM.

**Fix:** Call `closeBrowser()` in the route handler's `finally` block (or after the generator exhausts). A reference-counting approach is better if concurrent crawls are possible:

```ts
// route.ts — inside the try/catch, after for-await loop exhausts or errors:
} finally {
  controller.close();
  // Browser no longer needed for this crawl
  closeBrowser().catch(() => {});
}
```

Alternatively, add a `refcount` to `playwright.ts` that increments on `getBrowser()` and decrements + closes on zero.

#### C2. `waitForCrawlDelay` — timer never cleaned if signal is already aborted at call time
**File:** `crawler/robots.ts` lines 43-61

If `signal.aborted` is already `true` when `waitForCrawlDelay` is called, the function creates a Promise that will never resolve (the `abort` event already fired, so the listener is never triggered). The caller in `bfs.ts` line 60 does `.catch(() => {})` so the error is swallowed, but the `setTimeout` remains pending forever.

**Fix:** Check `signal.aborted` synchronously before creating the promise:

```ts
export async function waitForCrawlDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
```

---

### High Priority

#### H1. Playwright response has no size limit — potential OOM
**File:** `crawler/playwright.ts` line 58

`fetchPage` (Cheerio path) checks `content-length` and caps at 5 MB. `fetchWithPlaywright` calls `page.content()` with no equivalent limit. A page that injects massive DOM (e.g., a table with millions of rows) will produce an arbitrarily large HTML string.

**Fix:** Add a size check after `page.content()`:
```ts
const html = await page.content();
if (html.length > 5 * 1024 * 1024) return null; // 5 MB limit matches fetcher.ts
```

#### H2. Cheerio parses HTML twice on the hybrid path
**File:** `crawler/hybrid-fetcher.ts` line 14-28, `crawler/parser.ts` line 13

`needsJsRendering` calls `cheerio.load(html)` to inspect the DOM. If the page passes the check, `parseHtml` calls `cheerio.load` again on the same HTML. For large pages this is a measurable perf hit.

**Fix (non-blocking, medium-term):** Have `needsJsRendering` return the loaded `$` alongside the boolean, and thread it through to `parseHtml`. Or inline the heuristic into `hybridFetch` using regex checks for the SPA selectors (they are simple ID lookups that don't need a full parse):
```ts
// Fast regex alternative — avoids cheerio load entirely
function needsJsRendering(html: string): boolean {
  const bodyText = html.replace(/<[^>]+>/g, "").trim();
  if (bodyText.length < 100) return true;
  return /<(div|section)\s[^>]*id="(root|__next|app|__nuxt)"[^>]*>\s*<\/\1>/i.test(html);
}
```

#### H3. `robots.ts` ignores `user-agent` header on the robots.txt fetch itself
**File:** `crawler/robots.ts` lines 24-25

The `fetch` call for robots.txt sends no `User-Agent` header. Some sites serve different robots.txt content based on user-agent. The crawler should identify itself consistently.

**Fix:**
```ts
const response = await fetch(robotsUrl, {
  headers: { "User-Agent": userAgent },
  signal: AbortSignal.timeout(10_000),
});
```

#### H4. `robots.isAllowed` does not pass `userAgent` — checks wrong agent
**File:** `crawler/bfs.ts` line 54

`robots.isAllowed(normalized)` is called without the user-agent parameter. The `robots-parser` library's `isAllowed(url, ua?)` defaults to checking against `*` rules if no UA is passed. Since the crawler identifies as a custom agent (`ScreamingWeb/1.0`), it should pass this consistently.

Wait — looking at `robots.ts` line 34, the `isAllowed` wrapper already captures `userAgent` in its closure. So this is actually fine. The per-page call in `bfs.ts` correctly uses the closure. **Retracted.**

---

### Medium Priority

#### M1. `AbortSignal.timeout()` not supported in all Node versions
**File:** `crawler/robots.ts` line 25

`AbortSignal.timeout()` was added in Node 18+. If this project targets older Node versions, this will throw at runtime. The `fetcher.ts` uses the same API so this is consistent, but worth noting.

**Assessment:** Acceptable if the project requires Node 18+. No change needed if that is documented.

#### M2. `getCrawlDelay` return type cast is unnecessary
**File:** `crawler/robots.ts` line 35

```ts
getCrawlDelay: () => (parser.getCrawlDelay(userAgent) as number) ?? 0,
```

The `as number` cast is redundant — `getCrawlDelay` returns `number | undefined`, and the `?? 0` already handles the `undefined` case. The cast could mask a future type change.

**Fix:** Remove `as number`:
```ts
getCrawlDelay: () => parser.getCrawlDelay(userAgent) ?? 0,
```

#### M3. Route handler mutates session object directly
**File:** `app/api/crawl/route.ts` lines 90-96

`session.results.push(result)` and `session.stats.pagesCrawled++` directly mutate the session object returned from `createSession`. This works because sessions are in-memory references, but it bypasses the `updateSession` function that exists for this purpose. If `updateSession` ever adds side-effects (logging, persistence), this path will miss them.

**Fix (non-blocking):** Use `updateSession` consistently, or at minimum add a comment explaining the intentional direct mutation.

#### M4. No concurrency limit on Playwright pages
**File:** `crawler/playwright.ts`

The current BFS processes one page at a time (sequential), so this is not a bug today. But if parallelism is added later, `getBrowser()` returns a shared instance and multiple `newPage()` calls could exhaust browser resources. Worth adding a comment or semaphore stub now.

---

### Low Priority

#### L1. `process.on` handlers at module level — side effect on import
**File:** `crawler/playwright.ts` lines 71-72

The SIGTERM/SIGINT handlers are registered as a side effect of importing the module. If the module is imported in tests or non-server contexts, these handlers are still registered. Minor but could cause unexpected behavior in test environments.

#### L2. Default user-agent string mismatch
**File:** `crawler/robots.ts` line 19 vs `crawler/hybrid-fetcher.ts` line 37 vs `crawler/fetcher.ts` line 5

Three different default user-agent values:
- `robots.ts`: `"ScreamingWeb"`
- `hybrid-fetcher.ts`: `"ScreamingWeb/1.0"`
- `fetcher.ts`: `"ScreamingWeb/1.0"`

The robots.ts default is inconsistent. In practice, `hybridFetch` always passes `config.userAgent` through, so the default in `robots.ts` line 19 is only hit when called standalone. Still, it should match.

**Fix:** Change `robots.ts` line 19 to `"ScreamingWeb/1.0"`.

---

### Edge Cases Found by Scout

1. **Browser crash recovery:** If Chromium crashes mid-crawl (not just disconnect), `browserInstance.isConnected()` returns false, and the next `getBrowser()` relaunches. But the current in-flight `fetchWithPlaywright` call will throw — the catch returns `null`, which is correct. The singleton relaunch is handled. OK.

2. **robots.txt URL construction with non-standard seed URLs:** `new URL("/robots.txt", seedUrl)` correctly handles trailing slashes, query params, and fragments on the seed. OK.

3. **`normalizeUrl` called twice on seed URL:** In `bfs.ts`, the seed URL is normalized at line 22 and again at line 43 (via `normalizeUrl(item.url)` on the first queue item). Benign but redundant — `queued` set prevents re-processing.

4. **Race between `cancel()` and generator loop:** When the client disconnects, `cancel()` calls `abort()`. The generator checks `signal.aborted` at the top of its while-loop. If a fetch is in-flight when abort fires, the fetch will eventually throw, the catch in the route handler fires, and the stream closes. This is handled correctly.

5. **`HybridFetchResult.url` override on Playwright path:** Line 55 does `{ ...pwResult, url, method: "playwright" }`. This overwrites `pwResult.url` with the caller's `url` parameter (the normalized URL). Since `fetchWithPlaywright` does not follow redirects or update the URL, this is actually correct — it preserves the normalized URL. But if Playwright ever adds redirect following, this would mask the final URL. Worth a comment.

---

### Positive Observations

1. **SSRF protection** (`isSafeUrl`) is consistently applied before every fetch in BFS.
2. **Permissive robots.txt fallback** is the right default — crawl fails open, not closed.
3. **Route interception** in Playwright blocks images/fonts/CSS/media — good for bandwidth and speed.
4. **Clean separation** of concerns: robots, playwright, hybrid-fetcher, and BFS are each focused modules under 100 lines.
5. **AbortSignal threading** through the entire stack (route -> config -> generator -> crawl-delay) is well done.
6. **Schema validation** in the route handler with `crawlRequestSchema` ensures `useJs` and `respectRobotsTxt` are properly typed booleans.

---

### Recommended Actions

| Priority | Action | File |
|----------|--------|------|
| CRITICAL | Add `closeBrowser()` call in route handler cleanup (finally block or after generator) | `app/api/crawl/route.ts` |
| CRITICAL | Add early `signal.aborted` check in `waitForCrawlDelay` | `crawler/robots.ts` |
| HIGH | Add HTML size limit in `fetchWithPlaywright` (match 5 MB cap from fetcher.ts) | `crawler/playwright.ts` |
| HIGH | Add `User-Agent` header to robots.txt fetch | `crawler/robots.ts` |
| MEDIUM | Remove unnecessary `as number` cast in `getCrawlDelay` wrapper | `crawler/robots.ts` |
| MEDIUM | Unify default user-agent string across robots.ts/hybrid-fetcher.ts/fetcher.ts | `crawler/robots.ts` |
| LOW | Consider extracting user-agent constant to shared location | new file or `types.ts` |

---

### Metrics
- Type Coverage: ~100% (all interfaces explicit, no `any`)
- Test Coverage: Not assessed (no test files in scope)
- Linting Issues: 0 (no syntax errors, clean TypeScript)
- File sizes: All under 100 lines (well within 200-line limit)

### Unresolved Questions
1. Should `closeBrowser()` be called per-crawl or reference-counted for concurrent crawls?
2. Is there a plan to add parallel page fetching later? If so, a semaphore in playwright.ts should be added proactively.
3. Should the Playwright `waitUntil: "domcontentloaded"` be changed to `"networkidle"` for heavier SPAs? This trades speed for completeness.
