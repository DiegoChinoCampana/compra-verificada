import type { VercelRequest, VercelResponse } from "@vercel/node";
import pg from "pg";

/** GET /api/test-db — conexión + muestra y conteo de `articles` (Vercel Node). */
export const config = { maxDuration: 30 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== undefined) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const inicioTotal = Date.now();
  const tiempos = { conexion: 0, consulta: 0, total: 0 };

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
    const inicioConexion = Date.now();
    const client = await pool.connect();
    tiempos.conexion = Date.now() - inicioConexion;

    try {
      const inicioConsulta = Date.now();
      const resultado = await client.query(
        "SELECT * FROM articles ORDER BY id ASC LIMIT 10",
      );
      tiempos.consulta = Date.now() - inicioConsulta;

      const conteo = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM articles",
      );
      const totalStr = conteo.rows[0]?.count ?? "0";
      const total = Number.parseInt(totalStr, 10);

      tiempos.total = Date.now() - inicioTotal;

      res.status(200).json({
        status: "conectado",
        tiempos: {
          conexion: `${tiempos.conexion}ms`,
          consulta: `${tiempos.consulta}ms`,
          total: `${tiempos.total}ms`,
        },
        articles: {
          total: Number.isFinite(total) ? total : 0,
          muestra: resultado.rows,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    const mensaje =
      error instanceof Error ? error.message : String(error);
    res.status(500).json({
      status: "error",
      tiempo: `${Date.now() - inicioTotal}ms`,
      mensaje,
    });
  } finally {
    await pool.end();
  }
}
