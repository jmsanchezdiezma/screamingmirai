"use client";

import { Card } from "@/components/ui/card";
import type { CrawlResult } from "@/lib/types";

export function CrawlSummary({ results }: { results: CrawlResult[] }) {
  const indexable = results.filter((r) => r.esIndexable).length;
  const nonIndexable = results.length - indexable;
  const errors = results.filter((r) => r.status >= 400).length;

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Crawl Summary</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total URLs" value={results.length} />
        <Stat label="Indexable" value={indexable} className="text-green-600" />
        <Stat label="Non-Indexable" value={nonIndexable} className="text-amber-600" />
        <Stat label="Errors (4xx/5xx)" value={errors} className="text-red-600" />
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
