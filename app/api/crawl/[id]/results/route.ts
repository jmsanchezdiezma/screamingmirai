import { NextRequest } from "next/server";
import { getSession } from "@/store/crawl-session";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "50")),
  );

  const start = (page - 1) * limit;
  const end = start + limit;
  const paginated = session.results.slice(start, end);

  return Response.json({
    data: paginated,
    total: session.results.length,
    page,
    limit,
    totalPages: Math.ceil(session.results.length / limit),
  });
}
