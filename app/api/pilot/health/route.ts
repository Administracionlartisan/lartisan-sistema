import { env } from "cloudflare:workers";
import { ensurePilotSchema } from "@/db/schema";

export async function GET() {
  const database = (env as unknown as { DB: D1Database }).DB;
  await ensurePilotSchema(database);
  const tables = await database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'pilot_%' ORDER BY name",
  ).all<{ name: string }>();

  return Response.json({
    status: "ok",
    storage: "D1",
    tables: tables.results.map((table: { name: string }) => table.name),
  });
}
