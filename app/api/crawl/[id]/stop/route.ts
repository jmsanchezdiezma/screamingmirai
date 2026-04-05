import { NextRequest } from "next/server";
import { getSession, updateSession } from "@/store/crawl-session";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "running") {
    return Response.json(
      { error: "Crawl is not running" },
      { status: 400 },
    );
  }

  session.abortController?.abort();
  updateSession(id, { status: "stopped", completedAt: new Date() });

  return Response.json({ success: true });
}
