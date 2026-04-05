"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileJson, FileSpreadsheet } from "lucide-react";

export function TableToolbar({
  search,
  onSearchChange,
  resultCount,
  onExportCsv,
  onExportJson,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  onExportCsv: () => void;
  onExportJson: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-4 gap-4">
      <Input
        placeholder="Filter URLs..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="max-w-sm"
      />
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {resultCount} results
        </span>
        <Button onClick={onExportCsv} variant="outline" size="sm">
          <FileSpreadsheet className="h-4 w-4 mr-1" />
          CSV
        </Button>
        <Button onClick={onExportJson} variant="outline" size="sm">
          <FileJson className="h-4 w-4 mr-1" />
          JSON
        </Button>
      </div>
    </div>
  );
}
