import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * No importa el servidor ni Postgres: sirve para ver en Vercel si las variables
 * de entorno llegan (sin esperar timeout de /api/*).
 * GET /api/debug-env
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    vercel: Boolean(process.env.VERCEL),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    hasDbHost: Boolean(process.env.DB_HOST?.trim()),
    skipSchema: process.env.SKIP_DB_SCHEMA === "true" || process.env.SKIP_DB_SCHEMA === "1",
  });
}
