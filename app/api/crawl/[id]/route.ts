import { NextRequest } from "next/server";
import { getSession } from "@/store/crawl-session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({
    id: session.id,
    status: session.status,
    seedUrl: session.seedUrl,
    config: session.config,
    stats: session.stats,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    totalResults: session.results.length,
  });
}
