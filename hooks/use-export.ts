"use client";

import { useCallback } from "react";
import {
  exportAsCsv,
  downloadFile,
  generateExportFilename,
} from "@/utils/export";
import type { CrawlResult } from "@/lib/types";

export function useExport(seedUrl: string) {
  const exportCsv = useCallback(
    (results: CrawlResult[]) => {
      const content = exportAsCsv(results);
      const filename = generateExportFilename(seedUrl, "csv");
      downloadFile(content, filename, "text/csv");
    },
    [seedUrl],
  );

  return { exportCsv };
}
