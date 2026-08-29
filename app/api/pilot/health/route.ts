import { env } from "cloudflare:workers";
import { ensurePilotSchema } from "@/db/schema";

export async function GET() {
  await ensurePilotSchema(env.DB);
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'pilot_%' ORDER BY name",
  ).all<{ name: string }>();

  return Response.json({
    status: "ok",
    storage: "D1",
    tables: tables.results.map((table) => table.name),
  });
}
