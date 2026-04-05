"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function CrawlProgress({
  crawled,
  discovered,
  status,
}: {
  crawled: number;
  discovered: number;
  status: "idle" | "connecting" | "crawling" | "completed" | "stopped" | "error";
}) {
  const progress = discovered > 0 ? Math.min((crawled / discovered) * 100, 100) : 0;

  const statusLabels = {
    idle: "Ready",
    connecting: "Connecting...",
    crawling: "Crawling...",
    completed: "Completed",
    stopped: "Stopped",
    error: "Error",
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {statusLabels[status]}
        </span>
        <span className="text-sm font-medium">
          {crawled} / {discovered} pages
        </span>
      </div>

      <Progress value={progress} />

      <div className="flex gap-2">
        <Badge variant="secondary">{crawled} crawled</Badge>
        <Badge variant="outline">{discovered} discovered</Badge>
      </div>
    </Card>
  );
}
