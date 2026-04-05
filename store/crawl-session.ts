import { randomUUID } from "node:crypto";
import type { CrawlResult } from "@/lib/types";

export interface CrawlSession {
  id: string;
  status: "idle" | "running" | "completed" | "stopped" | "error";
  seedUrl: string;
  config: {
    maxDepth: number;
    maxPages: number;
    useJs: boolean;
    respectRobotsTxt: boolean;
  };
  results: CrawlResult[];
  stats: {
    pagesCrawled: number;
    pagesDiscovered: number;
    pagesFailed: number;
    currentDepth: number;
  };
  startedAt: Date | null;
  completedAt: Date | null;
  abortController: AbortController;
}

const sessions = new Map<string, CrawlSession>();

/** Auto-cleanup: delete completed sessions older than 1 hour */
const SESSION_TTL_MS = 60 * 60 * 1000;

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (
      session.status !== "running" &&
      session.status !== "idle" &&
      session.completedAt &&
      now - session.completedAt.getTime() > SESSION_TTL_MS
    ) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

if (cleanupInterval.unref) cleanupInterval.unref();

export function createSession(
  config: CrawlSession["config"],
  seedUrl: string,
): CrawlSession {
  const session: CrawlSession = {
    id: randomUUID(),
    status: "idle",
    seedUrl,
    config,
    results: [],
    stats: {
      pagesCrawled: 0,
      pagesDiscovered: 1,
      pagesFailed: 0,
      currentDepth: 0,
    },
    startedAt: null,
    completedAt: null,
    abortController: new AbortController(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): CrawlSession | undefined {
  return sessions.get(id);
}

export function updateSession(
  id: string,
  update: Partial<
    Pick<
      CrawlSession,
      "status" | "startedAt" | "completedAt" | "results" | "stats"
    >
  >,
): void {
  const session = sessions.get(id);
  if (session) {
    Object.assign(session, update);
  }
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function getActiveSessionCount(): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.status === "running") count++;
  }
  return count;
}
