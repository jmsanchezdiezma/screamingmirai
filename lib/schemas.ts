import { z } from "zod";

export const crawlRequestSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().min(1).max(10).default(3),
  maxPages: z.number().min(1).max(5000).default(500),
  useJs: z.boolean().default(false),
  respectRobotsTxt: z.boolean().default(true),
});

export type CrawlRequest = z.infer<typeof crawlRequestSchema>;
