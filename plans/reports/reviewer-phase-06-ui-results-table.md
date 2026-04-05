---
title: "Code Review: Phase 6 -- UI Results Table"
reviewer: code-reviewer
date: 2026-04-05
status: completed
---

# Code Review: Phase 6 -- UI Results Table

## Scope

- Files:
  - `components/table/columns.tsx` (82 LOC)
  - `components/table/data-table-column-header.tsx` (40 LOC, NEW)
  - `components/table/data-table.tsx` (85 LOC)
  - `components/table/table-toolbar.tsx` (43 LOC)
  - `components/crawl-results-table.tsx` (102 LOC)
  - `hooks/use-export.ts` (32 LOC)
  - `utils/export.ts` (82 LOC)
- Total: ~466 LOC across 7 files
- Focus: Sortable table, pagination, export, accessibility
- TanStack Table v8.21.3, React 19, Next.js 15

## Overall Assessment

Well-structured implementation. Files are clean, under 200-line limit, no useEffect violations, TypeScript compiles cleanly. The sorting + pagination composition has a critical UX bug where sorting state resets on page change. The `data-table-column-header.tsx` is a solid addition but has an accessibility gap. Export utilities are production-ready.

## Critical Issues

### C1. Sorting state resets on every page change (data-table.tsx)

**Severity:** Critical -- UX breaking
**File:** `components/crawl-results-table.tsx` + `components/table/data-table.tsx`

`DataTable` holds `SortingState` internally via `useState`. Every time the user clicks a pagination button, `CrawlResultsTable` re-renders with a new `paginatedData` slice. TanStack Table re-derives sorted rows from the new data prop each render, but the sorting state itself persists correctly because it is in local state within `DataTable`.

However, the real problem: **sorting only applies to the current page**. The `DataTable` receives `paginatedData` (already sliced to 50 rows), then sorts within that slice. A user sorting by status will see only the 50 rows on the current page reordered -- not a global sort of all results. This is a data correctness issue.

**Impact:** Users cannot sort their full result set. The sort only reorders within the current page, which is misleading.

**Fix options (pick one):**
1. **Sort before paginate** (recommended, client-side): Pass `filteredData` (full dataset) to DataTable, and let DataTable handle pagination internally via TanStack Table's `getPaginationRowModel` and `manualPagination`. This gives correct global sorting.
2. **Lift sorting out of DataTable**: Move `SortingState` to `CrawlResultsTable`, sort `filteredData` before slicing for pagination, then pass the already-sorted-and-paginated data to DataTable (remove `getSortedRowModel` from DataTable).

Option 1 is cleaner but requires refactoring pagination into DataTable. Option 2 is minimal diff:

```tsx
// crawl-results-table.tsx -- lift sorting up
const [sorting, setSorting] = useState<SortingState>([]);

const sortedData = useMemo(() => {
  if (!sorting.length) return filteredData;
  const { id, desc } = sorting[0];
  return [...filteredData].sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[id];
    const bVal = (b as Record<string, unknown>)[id];
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return desc ? -cmp : cmp;
  });
}, [filteredData, sorting]);

// Then: paginatedData = sortedData.slice(...)
// DataTable receives no sorting logic
```

### C2. `totalPages` can be 0, causing disabled-first-page state (crawl-results-table.tsx)

**Severity:** High -- edge case bug
**File:** `components/crawl-results-table.tsx:40`

```tsx
const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
```

Good -- `Math.max(1, ...)` prevents zero total pages. And `safePageIndex` clamps correctly. This is handled properly. No action needed.

## High Priority Issues

### H1. Missing keyboard accessibility on sort buttons (data-table-column-header.tsx)

**Severity:** High -- accessibility
**File:** `components/table/data-table-column-header.tsx:24-38`

The `Button` component from Base UI renders a `<button>` element, so it is natively keyboard-focusable and activatable via Enter/Space. However, the sort button has no `aria-label` or `aria-description` to convey its purpose to screen readers. A user navigating via screen reader only hears the column title, not that it is sortable or what the current sort state is.

**Fix:** Add `aria-label` to the sort button:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="-ml-3 h-8 data-[state=open]:bg-accent"
  onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
  aria-label={`Sort by ${title}${
    column.getIsSorted() === "asc"
      ? ", sorted ascending"
      : column.getIsSorted() === "desc"
        ? ", sorted descending"
        : ", unsorted"
  }`}
>
```

Additionally, the parent `<th>` should carry `aria-sort` to conform with WAI-ARIA table pattern. This could be added in `data-table.tsx` on the `TableHead`:

```tsx
<TableHead
  key={header.id}
  aria-sort={
    header.column.getIsSorted() === "asc"
      ? "ascending"
      : header.column.getIsSorted() === "desc"
        ? "descending"
        : undefined
  }
>
```

### H2. Missing `aria-live` region for search result count (table-toolbar.tsx)

**Severity:** Medium-High -- accessibility
**File:** `components/table/table-toolbar.tsx:29-31`

The result count changes as users type in the search field, but screen readers will not announce the change. Wrap the count in an `aria-live="polite"` region:

```tsx
<span className="text-sm text-muted-foreground" aria-live="polite">
  {resultCount} results
</span>
```

### H3. Export `downloadFile` synchronous DOM manipulation risks (utils/export.ts:54-68)

**Severity:** Medium -- reliability
**File:** `utils/export.ts:54-68`

The `downloadFile` function appends a temporary `<a>` to the DOM, clicks it, then removes it synchronously. While this is the standard pattern, if the click is somehow asynchronous (browser-dependent), `removeChild` could fire before the download initiates. More practically, there is no cleanup guarantee if an error occurs between `appendChild` and `removeChild`.

**Mitigation:** Wrap in try/finally:

```ts
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
```

## Medium Priority Issues

### M1. `Button` component uses Base UI -- `data-[state=open]` selector may not apply (data-table-column-header.tsx:27)

**Severity:** Low-Medium -- visual
**File:** `components/table/data-table-column-header.tsx:27`

The className includes `data-[state=open]:bg-accent`. This selector is designed for popover/combobox triggers that have an `open` state. A plain `<button>` for column sorting never enters an `open` state, so this CSS rule is dead code. Harmless but misleading.

### M2. CSV export does not escape semicolons (utils/export.ts)

**Severity:** Low -- edge case
**File:** `utils/export.ts:29-35`

The `escape` function handles commas, quotes, and newlines in CSV values, but does not escape semicolons. While RFC 4180 only requires quoting for commas, quotes, and line breaks, some CSV parsers (particularly European locale Excel) use semicolons as delimiters. Since the delimiter here is a comma, this is technically correct. Just flagging for awareness.

### M3. Column sort on `url` column sorts lexicographically, not by domain/path hierarchy

**Severity:** Low -- UX expectation
**File:** `components/table/columns.tsx`

Sorting URLs lexicographically means `https://example.com/z` sorts before `https://example.com/a/b`. Users might expect path-hierarchy sorting. This is a nice-to-have, not a blocker.

### M4. React Compiler warning on `useReactTable` (data-table.tsx)

**Severity:** Low -- tooling
**File:** `components/table/data-table.tsx:32`

ESLint reports `react-hooks/incompatible-library` warning because TanStack Table's `useReactTable()` returns functions that cannot be safely memoized by React Compiler. This is a known limitation and does not cause runtime issues. If React Compiler is enabled, this component will be excluded from automatic memoization, which is fine.

## Positive Observations

1. **No useEffect violations** -- Confirmed zero useEffect usage across all table components. Data flows via props and local state only. Export uses useCallback properly.
2. **Clean TypeScript** -- `npx tsc --noEmit` passes with zero errors. Generic types on `DataTable<TData, TValue>` and `DataTableColumnHeader<TData, TValue>` are correct.
3. **All files under 200 lines** -- Largest is `crawl-results-table.tsx` at 102 lines.
4. **Proper null handling** -- `title` field (nullable) uses `|| "--"` fallback and optional chaining in filter (`row.title?.toLowerCase().includes(q) ?? false`).
5. **`rel="noopener noreferrer"`** on external links in URL column -- prevents tab-nabbing.
6. **Client-side pagination prevents memory issues** -- Only 50-row slices rendered at a time.
7. **`Math.max(1, ...)` guard on totalPages** -- Prevents "0 pages" display.
8. **`safePageIndex` clamping** -- `Math.min(pageIndex, totalPages - 1)` prevents out-of-bounds slice when filtered results shrink.
9. **Export utilities are well-structured** -- BOM prefix for Excel, proper CSV escaping, filename generation with hostname extraction and try/catch on URL parsing.
10. **Memoized filtered data** -- `useMemo` on `filteredData` with correct dependency array `[results, search]`.

## Edge Cases Found by Scout

1. **Sort-then-filter interaction**: If user sorts a column, then types in search, the filtered data will be re-sorted on every keystroke since DataTable re-renders with new data. The sort state persists (in DataTable's useState) but the visible sort effect re-applies to the new filtered set. This is correct behavior but worth noting.
2. **Empty results + sort**: If `filteredData` is empty, DataTable correctly shows "No results." placeholder.
3. **Rapid page clicks**: The `setPageIndex` functional updater `(p) => Math.min(totalPages - 1, p + 1)` is safe for rapid clicks since it reads current state. However, `totalPages` is derived from `filteredData` which is memoized, so it is stable within a render. No race condition.
4. **Export with large datasets**: `exportAsJson` and `exportAsCsv` operate on `filteredData` (the full filtered set, not just current page). For 5000 results, JSON.stringify on the full dataset happens synchronously on the main thread. Could cause a brief UI freeze. Not blocking for current scope (max 5000 rows), but worth noting for future scale.
5. **XSS via URL column**: URLs are rendered in `<a href={url}>` without sanitization. A malicious crawl result containing `javascript:alert(1)` as a URL would execute when clicked. The URL comes from the server (crawler output), not direct user input, so the attack surface is limited to a compromised or malicious target site injecting bad URLs into its own HTML. Low severity but worth flagging.

## Recommended Actions

1. **[Critical] Fix sort-before-paginate** -- Move sorting above pagination in `crawl-results-table.tsx` so sorting applies to the full filtered dataset, not just the current page. (C1)
2. **[High] Add `aria-label` to sort buttons** -- Include sort state in the label for screen reader users. (H1)
3. **[High] Add `aria-sort` to `<th>` elements** -- Conform to WAI-ARIA table sorting pattern. (H1)
4. **[High] Add `aria-live="polite"` to result count** -- Announce filter result changes. (H2)
5. **[Medium] Wrap downloadFile in try/finally** -- Guarantee DOM cleanup. (H3)
6. **[Low] Remove dead `data-[state=open]` selector** -- In column header className. (M1)

## Metrics

- Type Coverage: 100% (tsc --noEmit passes clean)
- Test Coverage: 0% (no test files found for these components -- not blocking for UI review but should be addressed)
- Linting Issues: 1 warning (React Compiler incompatible library -- acceptable)
- File Size: All under 200 lines (max: 102 lines)

## Unresolved Questions

1. Should the table support multi-column sort? Currently `toggleSorting` toggles a single column. TanStack supports multi-sort but it is not enabled.
2. The plan mentions "Column-specific filters" as a functional requirement but no column filter UI is implemented. Is this deferred?
3. The plan mentions "server-side pagination" but the implementation is fully client-side. Is this intentional for current scope?
