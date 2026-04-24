import pg from "pg";
import dotenv from "dotenv";
import { IPC_SCHEMA_STATEMENTS } from "./schemaSql.generated.js";

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

/** SSL: Postgres remoto con certificado propio suele fallar si rejectUnauthorized queda en true. */
function poolSslOption(): pg.PoolConfig["ssl"] | undefined {
  const cs = process.env.DATABASE_URL ?? "";
  const sslModeRequire =
    /\bsslmode=require\b/i.test(cs) ||
    /\bsslmode=verify-full\b/i.test(cs) ||
    process.env.PGSSLMODE === "require";
  if (!sslModeRequire) return undefined;
  if (process.env.PGSSL_REJECT_UNAUTHORIZED === "false") {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

/** En Vercel (serverless) conviene pocos sockets por instancia; en servidor propio podés subir el máximo. */
const poolMax = process.env.VERCEL ? 1 : Number(process.env.PG_POOL_MAX ?? 10);

const poolConfig: pg.PoolConfig = {
  connectionString: connectionString(),
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
  connectionTimeoutMillis: 20000,
};

const ssl = poolSslOption();
if (ssl !== undefined) {
  poolConfig.ssl = ssl;
}

export const pool = new Pool(poolConfig);

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
  for (const stmt of IPC_SCHEMA_STATEMENTS) {
    await pool.query(stmt);
  }
  console.log("[db] Esquema IPC aplicado (tablas + configs por defecto).");
}
