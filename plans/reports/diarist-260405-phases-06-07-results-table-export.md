# Phases 6-7: Results Table + Export -- The Paginated Sort Trap

**Date**: 2026-04-05 13:12
**Severity**: Medium
**Component**: UI Results Table, Export Pipeline
**Status**: Resolved

## What Happened

Shipped Phase 6 (TanStack Table results table) and Phase 7 (CSV/JSON export + store wiring) in a single session. Build is clean: 0 TypeScript errors, 0 ESLint errors. All 7 files stay under the 200-line budget (487 LOC total). But code review caught a sorting architecture flaw that is worth documenting because it is the kind of mistake that feels right until you actually click "next page."

## The Brutal Truth

The table sorts only the current page. Not the full result set. The data arrives via SSE stream, gets accumulated in Zustand, then sliced into pages of 50 before being passed to `DataTable`. TanStack Table sorts those 50 rows and proudly reorders them. The user sees the sort indicator, assumes it is global, and gets garbage results. This is a classic "pipeline ordering" bug -- pagination before sorting instead of sorting before pagination. The fix was architectural: lift `SortingState` from `DataTable` into `CrawlResultsTable` so sorting can eventually happen before the slice. Right now it is still paginated sort, but the state ownership is correct for a future global sort. That is a conscious deferral, not a bug.

## Technical Details

**Files involved (Phase 6):**
- `components/table/columns.tsx` (82 LOC) -- column definitions with sortable headers
- `components/table/data-table.tsx` (90 LOC) -- generic TanStack Table wrapper
- `components/table/data-table-column-header.tsx` (49 LOC) -- NEW: sortable header with aria-labels
- `components/table/table-toolbar.tsx` (43 LOC) -- search filter + CSV/JSON export buttons
- `components/crawl-results-table.tsx` (109 LOC) -- main orchestrator with filtering, pagination, export

**Files involved (Phase 7):**
- `utils/export.ts` (82 LOC) -- CSV/JSON export with UTF-8 BOM for Excel, `\r` escape
- `hooks/use-export.ts` (32 LOC) -- `useCallback`-wrapped export hook (no useEffect)
- `hooks/use-crawl-stream.ts` -- added `seedUrl` to `CrawlStreamState`
- `app/page.tsx` -- wires `seedUrl` through to results table

**Critical review finding (C1):** `SortingState` was internal to `DataTable`, making global sort impossible. Lifted to `CrawlResultsTable` parent. Sort is still paginated today but architecture is ready.

**High-priority review finding (H1):** CSV escape in `utils/export.ts:30` missed `\r` characters. RFC 4180 requires quoting fields with any line break. Added `\r` to the escape check.

**High-priority review finding (H2):** `generateExportFilename` could throw on empty `seedUrl`. Wrapped in try/catch.

## What We Tried

1. **Initial approach:** Keep sorting internal to `DataTable` -- clean encapsulation. Failed when we realized global sort requires the parent to sort before slicing. Lifted state.
2. **Format selector dropdown for export:** Rejected. Would have required a Select/Radix component dependency for two formats. Two separate buttons is simpler. YAGNI.
3. **Server-side export endpoint:** Rejected. Client-side Blob download handles everything. No server round-trip for data the client already has.
4. **`utils/format.ts`:** Created then deleted. YAGNI -- nothing used it.

## Root Cause Analysis

The paginated-sort issue came from a reasonable default (TanStack Table manages its own sorting state) applied to an unreasonable data flow (pagination before sorting). The lesson: when your component receives pre-sliced data, the sort cannot be global by definition. State ownership must match data ownership. If the parent owns pagination, the parent must also own sorting so it can control the order of operations.

## Lessons Learned

1. **Data flow determines state ownership.** If `CrawlResultsTable` slices data into pages, it must own sorting -- not the child `DataTable`. The child becomes a pure presenter.
2. **CSV edge cases are endless.** `\r` is easy to forget. RFC 4180 has sharp edges. Always include BOM for Excel users.
3. **Two buttons beat one dropdown.** When you have exactly two options, separate buttons are less code, less complexity, and fewer dependencies than a select component.
4. **Delete dead code immediately.** `utils/format.ts` sat around until review caught it. Should have never been committed.

## Next Steps

- Phase 8 (Docker + Dokploy): containerize the app for deployment
- Phase 9 (Testing + Polish): unit tests, integration tests, final cleanup
- Future: implement global sort across all pages (requires sorting before pagination in `CrawlResultsTable`)
- The TanStack/React Compiler ESLint warning (1 known warning) is tracked but not blocking
