"use client";

import { useCallback } from "react";
import {
  exportAsJson,
  exportAsCsv,
  downloadFile,
  generateExportFilename,
} from "@/utils/export";
import type { CrawlResult } from "@/lib/types";

export function useExport(seedUrl: string) {
  const exportJson = useCallback(
    (results: CrawlResult[]) => {
      const content = exportAsJson(results);
      const filename = generateExportFilename(seedUrl, "json");
      downloadFile(content, filename, "application/json");
    },
    [seedUrl],
  );

  const exportCsv = useCallback(
    (results: CrawlResult[]) => {
      const content = exportAsCsv(results);
      const filename = generateExportFilename(seedUrl, "csv");
      downloadFile(content, filename, "text/csv");
    },
    [seedUrl],
  );

  return { exportJson, exportCsv };
}
