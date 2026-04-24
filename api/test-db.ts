import type { VercelRequest, VercelResponse } from "@vercel/node";
import pg from "pg";

/** GET /api/test-db — prueba de conexión a Postgres (Vercel Node, no Next.js). */
export const config = { maxDuration: 30 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== undefined) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const startTime = Date.now();
  const cs = process.env.DATABASE_URL ?? "";
  const sslDisabled =
    /\bsslmode=disable\b/i.test(cs) ||
    process.env.PGSSLMODE?.toLowerCase() === "disable";
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ...(sslDisabled ? { ssl: false as const } : {}),
    connectionTimeoutMillis: 10_000,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{ now: Date }>("SELECT NOW() AS now");
      res.status(200).json({
        status: "conectado",
        tiempo: `${Date.now() - startTime}ms`,
        hora_servidor: result.rows[0]?.now,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({
      status: "error",
      tiempo: `${Date.now() - startTime}ms`,
      mensaje,
    });
  } finally {
    await pool.end();
  }
}
