/**
 * Conecta a la base administrativa (por defecto "postgres") y crea DB_NAME si no existe.
 * Uso: npm run db:ensure (desde la raíz del monorepo o desde server/).
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const targetDb = process.env.DB_NAME;
if (!targetDb) {
  console.error("Definí DB_NAME en server/.env");
  process.exit(1);
}

const adminDb = process.env.POSTGRES_ADMIN_DB ?? "postgres";

function clientConfig(): pg.ClientConfig {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.pathname = `/${adminDb}`;
    return { connectionString: u.toString() };
  }
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "",
    database: adminDb,
  };
}

async function main() {
  const client = new pg.Client(clientConfig());
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
      [targetDb],
    );
    if (rows[0]?.exists) {
      console.log(`La base "${targetDb}" ya existe.`);
      return;
    }
    const ident = `"${targetDb.replace(/"/g, '""')}"`;
    await client.query(`CREATE DATABASE ${ident}`);
    console.log(`Base "${targetDb}" creada.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
