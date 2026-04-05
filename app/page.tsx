"use client";

import { CrawlForm } from "@/components/crawl-form";
import { CrawlProgress } from "@/components/crawl-progress";
import { CrawlSummary } from "@/components/crawl-summary";
import { CrawlResultsTable } from "@/components/crawl-results-table";
import { useCrawlStream } from "@/hooks/use-crawl-stream";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { state, startCrawl, stopCrawl, reset } = useCrawlStream();
  const isIdle = state.status === "idle";
  const isActive = state.status === "connecting" || state.status === "crawling";
  const isDone =
    state.status === "completed" ||
    state.status === "stopped" ||
    state.status === "error";

  return (
    <main className="container mx-auto py-10 max-w-6xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">ScreamingWeb</h1>
        <p className="text-muted-foreground">
          SEO Crawler — Discover internal HTML URLs
        </p>
      </div>

      {isIdle && <CrawlForm onSubmit={startCrawl} />}

      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          {state.error}
        </div>
      )}

      {isActive && (
        <div className="space-y-4">
          <CrawlProgress
            crawled={state.stats.crawled}
            discovered={state.stats.discovered}
            status={state.status}
          />
          <Button onClick={stopCrawl} variant="destructive">
            Stop Crawl
          </Button>
        </div>
      )}

      {isDone && !isIdle && (
        <div className="space-y-4">
          <CrawlProgress
            crawled={state.stats.crawled}
            discovered={state.stats.discovered}
            status={state.status}
          />
          <div className="flex gap-2">
            <Button onClick={reset}>New Crawl</Button>
          </div>
          {state.results.length > 0 && (
            <>
              <CrawlSummary results={state.results} />
              <CrawlResultsTable
                results={state.results}
                seedUrl={state.seedUrl}
              />
            </>
          )}
        </div>
      )}
    </main>
  );
}
