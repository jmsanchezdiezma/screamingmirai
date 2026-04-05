# Code Review: Phase 7 — Export & Store

**Reviewer:** code-reviewer agent
**Date:** 2026-04-05
**Scope:** Phase 7 implementation (export utilities, format helpers, export hook, toolbar, results table wiring, crawl stream seedUrl, page integration)

## Scope

- Files: `utils/export.ts`, `utils/format.ts`, `hooks/use-export.ts`, `components/table/table-toolbar.tsx`, `components/crawl-results-table.tsx`, `hooks/use-crawl-stream.ts`, `app/page.tsx`
- LOC: 509 total across 7 files
- Focus: Phase 7 specific changes (export + store)
- Build: TypeScript compiles clean (0 errors), ESLint 0 errors / 3 warnings

## Overall Assessment

Clean, focused implementation. The export logic is correct, Blob URL lifecycle is handled properly, and the data flow from stream through to export is well-wired. The `useExport` hook uses `useCallback` correctly (not useEffect), and the filtered-results-are-exported behavior is the right UX choice. A few issues worth addressing below.

## Critical Issues

None.

## High Priority

### H1. CSV escape does not handle carriage returns (`\r`)

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/export.ts:30`

The escape function checks for `\n` but not `\r`. If a title or URL contains a bare `\r` (or `\r\n` where the `\r` survives), it will break CSV parsing without being quoted.

```ts
// Current:
if (str.includes(",") || str.includes('"') || str.includes("\n")) {

// Fix:
if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
```

This is a correctness bug that will surface with real-world page titles containing carriage returns. RFC 4180 requires fields containing line breaks to be quoted.

### H2. `generateExportFilename` throws on empty `seedUrl` without guard

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/export.ts:73`

`new URL(seedUrl)` will throw `TypeError` if `seedUrl` is empty or invalid. While the UI flow currently prevents this (export button only appears after a crawl with a valid URL), there is no defensive check. The `seedUrl` defaults to `""` in `INITIAL_STATE` of `use-crawl-stream.ts:27`.

If a developer wires the export button differently in the future or if state gets out of sync, this becomes an unhandled exception. Add a guard:

```ts
export function generateExportFilename(seedUrl: string, format: "csv" | "json"): string {
  const domain = seedUrl
    ? new URL(seedUrl).hostname.replace(/^www\./, "")
    : "export";
  const date = new Date().toISOString().split("T")[0];
  return `screamingweb-${domain}-${date}.${format}`;
}
```

## Medium Priority

### M1. Unused import: `Download` from lucide-react

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/components/table/table-toolbar.tsx:5`

```ts
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
```

`Download` is imported but never used. ESLint flags this as a warning. Remove it.

### M2. `format.ts` utilities are unused

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/format.ts`

None of the three exported functions (`formatNumber`, `formatBytes`, `truncate`) are imported anywhere in the codebase. This is dead code per YAGNI. The `truncate` function is defined here but the columns component uses a CSS class `truncate` instead.

Recommendation: Either wire these into the UI (e.g., `formatNumber` for inlinks count, `truncate` for long titles) or remove the file until needed. Leaving dead imports adds noise for future readers.

### M3. Blob URL revoked synchronously after `click()` — potential race on slow browsers

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/export.ts:59-66`

The sequence is: create blob URL, append `<a>`, click(), remove `<a>`, revokeObjectURL(). The revocation happens synchronously after `click()`. In practice, this works in all modern browsers because `click()` initiates the download before returning. However, the safest pattern uses a short `setTimeout` for revocation, or uses the `blob:` URL directly in the click handler with revocation on the next tick.

This is low-risk in practice but worth noting for correctness. The current code is acceptable.

### M4. CSV does not include a BOM for Excel compatibility

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/export.ts:53`

When CSV files are opened in Microsoft Excel, UTF-8 characters (common in page titles like em-dashes, curly quotes, non-ASCII characters) will display as garbled text unless the file starts with a UTF-8 BOM (`\uFEFF`). Since this is an SEO tool that will likely be used with Excel, consider prepending the BOM:

```ts
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + content], { type: mimeType });
  // ...
}
```

Or scope it to CSV only by passing a flag. The JSON export does not need this.

## Low Priority

### L1. `useExport` hook could accept empty results gracefully

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/hooks/use-export.ts`

If `results` is an empty array, the export will still generate a file with just headers (CSV) or an empty results array (JSON). This is not a bug, but consider adding an early return or disabling the export button when `filteredData.length === 0`.

### L2. Store cleanup interval never clears

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/store/crawl-session.ts:31-45`

The `setInterval` is stored in `cleanupInterval` and `.unref()` is called (good for Node.js to not block process exit), but the interval is never cleared. For this in-memory, server-side store it is fine — the interval lives for the lifetime of the process. Noted for completeness.

### L3. `downloadFile` appends/removes `<a>` from `document.body`

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/utils/export.ts:63-65`

This is a standard pattern, but appending to `document.body` could theoretically trigger a layout reflow. An alternative is to append to `document.head` or reuse a hidden element. This is negligible in practice.

## Edge Cases Found by Scout

1. **`\r` in CSV fields** (H1 above) — carriage returns not handled by escape function
2. **Empty `seedUrl` crash path** (H2 above) — `new URL("")` throws
3. **Export of filtered results** — Correctly implemented: `onExportCsv={() => exportCsv(filteredData)}` passes the search-filtered subset, which is the right UX
4. **Rapid double-click on export** — Would create two downloads; no debounce guard. Low severity since each download is independent and Blob URLs are individually revoked
5. **Session store `results` mutation** — In `route.ts:90`, `session.results.push(result)` directly mutates the array stored in the Map. Since this is single-threaded Node.js and the Map entry is not shared across requests (each session is isolated), this is safe. Noted for awareness.

## Positive Observations

1. **Blob URL cleanup is correct** — `URL.revokeObjectURL(url)` is called after `click()`, preventing memory leaks
2. **No useEffect for data fetching** — Full compliance with the no-use-effect rule. Export is event-driven via `useCallback`
3. **File sizes well under 200 lines** — Largest file is `use-crawl-stream.ts` at 168 lines
4. **`useCallback` dependencies are correct** — `[seedUrl]` is the right dependency for the export callbacks
5. **Filtered data is exported** — The toolbar passes `filteredData` to export, not the full dataset, which matches user expectations
6. **`seedUrl` data flow is clean** — `useCrawlStream` stores it in state on crawl start, page.tsx passes it through to the table, table passes it to `useExport`
7. **CSV escaping follows RFC 4180** — Double-quote escaping (`""`) is correct
8. **TypeScript compiles with zero errors** — Clean type safety across all files

## Recommended Actions

1. **[High]** Fix CSV escape to handle `\r` characters (one-line fix in `utils/export.ts:30`)
2. **[High]** Add defensive guard in `generateExportFilename` for empty/invalid `seedUrl`
3. **[Medium]** Remove unused `Download` import from `table-toolbar.tsx`
4. **[Medium]** Decide on `format.ts` — wire into UI or remove dead code
5. **[Medium]** Add UTF-8 BOM to CSV export for Excel compatibility

## Metrics

- Type Coverage: 100% (zero TS errors)
- Test Coverage: N/A (Phase 9)
- Linting Issues: 3 warnings (0 errors) — 1 unused var in this phase's files (`Download`), 1 unused var in `route.ts`, 1 TanStack table compiler warning

## Unresolved Questions

1. Should `format.ts` utilities be wired into the table columns now, or deferred to Phase 9 (testing/polish)?
2. The plan mentions "in-memory store cleanup" as a Phase 7 deliverable — the `crawl-session.ts` cleanup interval already exists and appears to have been implemented in a prior phase. Is there additional cleanup work expected, or is this complete?
