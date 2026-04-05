export const dynamic = "force-dynamic";

export async function GET() {
  const memUsage = process.memoryUsage();
  const memMb = Math.round(memUsage.heapUsed / 1024 / 1024);

  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    memory: `${memMb}MB`,
  });
}
