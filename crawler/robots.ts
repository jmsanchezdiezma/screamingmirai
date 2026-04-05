import robotsParser from "robots-parser";

export interface RobotsConfig {
  isAllowed: (url: string) => boolean;
  getCrawlDelay: () => number;
}

const DEFAULT_ROBOTS: RobotsConfig = {
  isAllowed: () => true,
  getCrawlDelay: () => 0,
};

/**
 * Fetch and parse robots.txt for a domain.
 * Returns a permissive config if robots.txt is missing or unreachable.
 */
export async function fetchRobotsTxt(
  seedUrl: string,
  userAgent: string = "ScreamingWeb/1.0",
): Promise<RobotsConfig> {
  const robotsUrl = new URL("/robots.txt", seedUrl).href;

  try {
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return DEFAULT_ROBOTS;

    const text = await response.text();
    const parser = robotsParser(robotsUrl, text);

    return {
      isAllowed: (url: string) => parser.isAllowed(url, userAgent) ?? true,
      getCrawlDelay: () => (parser.getCrawlDelay(userAgent) as number) ?? 0,
    };
  } catch {
    return DEFAULT_ROBOTS;
  }
}

/** Delay before next request if robots.txt specifies Crawl-delay */
export async function waitForCrawlDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
