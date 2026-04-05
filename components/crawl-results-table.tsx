"use client";

import { useState, useMemo } from "react";
import { type SortingState } from "@tanstack/react-table";
import { DataTable } from "./table/data-table";
import { columns } from "./table/columns";
import { TableToolbar } from "./table/table-toolbar";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useExport } from "@/hooks/use-export";
import type { CrawlResult } from "@/lib/types";

const PAGE_SIZE = 50;

export function CrawlResultsTable({
  results,
  seedUrl,
}: {
  results: CrawlResult[];
  seedUrl: string;
}) {
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const { exportCsv, exportJson } = useExport(seedUrl);

  const filteredData = useMemo(() => {
    if (!search) return results;
    const q = search.toLowerCase();
    return results.filter(
      (row) =>
        row.url.toLowerCase().includes(q) ||
        (row.title?.toLowerCase().includes(q) ?? false),
    );
  }, [results, search]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const paginatedData = filteredData.slice(
    safePageIndex * PAGE_SIZE,
    (safePageIndex + 1) * PAGE_SIZE,
  );

  return (
    <div className="space-y-4">
      <TableToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPageIndex(0);
        }}
        resultCount={filteredData.length}
        onExportCsv={() => exportCsv(filteredData)}
        onExportJson={() => exportJson(filteredData)}
      />

      <DataTable
        columns={columns}
        data={paginatedData}
        sorting={sorting}
        onSortingChange={setSorting}
      />

      <div className="flex items-center justify-end gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setPageIndex(0)}
          disabled={safePageIndex === 0}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
          disabled={safePageIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm px-2" aria-live="polite">
          Page {safePageIndex + 1} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePageIndex >= totalPages - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setPageIndex(totalPages - 1)}
          disabled={safePageIndex >= totalPages - 1}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
