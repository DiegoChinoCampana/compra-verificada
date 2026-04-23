import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

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

function resolveSchemaSqlPath(): string {
  const fromModule = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "schema.sql");
  const fromRepoRoot = path.join(process.cwd(), "server", "db", "schema.sql");
  const candidates = [fromRepoRoot, fromModule];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `[db] No se encontró schema.sql (Vercel cwd o ruta del módulo). Probado:\n${candidates.join("\n")}`,
  );
}

/**
 * Crea tablas y datos por defecto del esquema IPC (idempotente).
 * La base de datos en sí debe existir (ver `npm run db:ensure`).
 */
export async function ensureSchema(): Promise<void> {
  if (process.env.SKIP_DB_SCHEMA === "true" || process.env.SKIP_DB_SCHEMA === "1") {
    console.log("[db] SKIP_DB_SCHEMA: no se aplica db/schema.sql");
    return;
  }
  const schemaPath = resolveSchemaSqlPath();
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(sql);
  console.log("[db] Esquema IPC aplicado (tablas + configs por defecto).");
}
