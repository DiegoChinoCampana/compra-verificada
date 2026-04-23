import pg from "pg";
import dotenv from "dotenv";
import { IPC_SCHEMA_SQL } from "./schemaSql.generated.js";

dotenv.config();

const { Pool } = pg;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const dbname = process.env.DB_NAME ?? "postgres";
  const user = process.env.DB_USER ?? "postgres";
  const password = process.env.DB_PASSWORD ?? "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbname}`;
}

/** En Vercel (serverless) conviene pocos sockets por instancia; en servidor propio podés subir el máximo. */
const poolMax = process.env.VERCEL ? 1 : Number(process.env.PG_POOL_MAX ?? 10);

export const pool = new Pool({
  connectionString: connectionString(),
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
});

/**
 * Crea tablas y datos por defecto del esquema IPC (idempotente).
 * El SQL viene embebido en build (`schemaSql.generated.ts`) para Vercel/serverless.
 * La base de datos en sí debe existir (ver `npm run db:ensure`).
 */
export async function ensureSchema(): Promise<void> {
  if (process.env.SKIP_DB_SCHEMA === "true" || process.env.SKIP_DB_SCHEMA === "1") {
    console.log("[db] SKIP_DB_SCHEMA: no se aplica db/schema.sql");
    return;
  }
  await pool.query(IPC_SCHEMA_SQL);
  console.log("[db] Esquema IPC aplicado (tablas + configs por defecto).");
}
