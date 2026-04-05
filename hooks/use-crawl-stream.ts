"use client";

import { useState, useCallback, useRef } from "react";
import type { CrawlResult } from "@/lib/types";

type StreamEvent =
  | { type: "session"; id: string }
  | { type: "page"; data: CrawlResult; stats: { crawled: number; discovered: number } }
  | { type: "done"; total: number }
  | { type: "error"; error: string };

export interface CrawlStreamState {
  status: "idle" | "connecting" | "crawling" | "completed" | "stopped" | "error";
  sessionId: string | null;
  seedUrl: string;
  results: CrawlResult[];
  stats: {
    crawled: number;
    discovered: number;
  };
  error: string | null;
}

const INITIAL_STATE: CrawlStreamState = {
  status: "idle",
  sessionId: null,
  seedUrl: "",
  results: [],
  stats: { crawled: 0, discovered: 0 },
  error: null,
};

/** Extract a human-readable error from zod flatten() or plain error shapes */
function extractErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "Failed to start crawl";
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== "object") return "Failed to start crawl";
  const e = err as Record<string, unknown>;
  // zod .flatten() puts field errors here
  if (e.fieldErrors && typeof e.fieldErrors === "object") {
    const fields = Object.values(e.fieldErrors as Record<string, string[]>).flat();
    if (fields.length > 0) return fields[0];
  }
  if (typeof e.message === "string") return e.message;
  return "Failed to start crawl";
}

export function useCrawlStream() {
  const [state, setState] = useState<CrawlStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<CrawlResult[]>([]);

  const startCrawl = useCallback(
    async (options: { url: string; maxDepth: number; maxPages: number; useJs: boolean; respectRobotsTxt: boolean }) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      resultsRef.current = [];

      setState({
        status: "connecting",
        sessionId: null,
        seedUrl: options.url,
        results: [],
        stats: { crawled: 0, discovered: 0 },
        error: null,
      });

      let receivedTerminal = false;

      try {
        const response = await fetch("/api/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(extractErrorMessage(body));
        }

        setState((prev) => ({ ...prev, status: "crawling" }));

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));

              if (event.type === "session") {
                setState((prev) => ({ ...prev, sessionId: event.id }));
              } else if (event.type === "page") {
                resultsRef.current.push(event.data);
                setState((prev) => ({
                  ...prev,
                  results: resultsRef.current,
                  stats: {
                    crawled: event.stats.crawled,
                    discovered: event.stats.discovered,
                  },
                }));
              } else if (event.type === "done") {
                receivedTerminal = true;
                setState((prev) => ({
                  ...prev,
                  status: "completed",
                  stats: { crawled: event.total, discovered: prev.stats.discovered },
                }));
              } else if (event.type === "error") {
                receivedTerminal = true;
                setState((prev) => ({ ...prev, status: "error", error: event.error }));
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }

        // C2: Guard against stream ending without terminal event
        if (!receivedTerminal) {
          setState((prev) => {
            if (prev.status === "crawling" || prev.status === "connecting") {
              return { ...prev, status: "error", error: "Connection lost" };
            }
            return prev;
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setState((prev) => ({ ...prev, status: "stopped" }));
        } else {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          }));
        }
      }
    },
    [],
  );

  const stopCrawl = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, status: "stopped" }));
  }, []);

  const reset = useCallback(() => {
    resultsRef.current = [];
    setState(INITIAL_STATE);
  }, []);

  return { state, startCrawl, stopCrawl, reset };
}
