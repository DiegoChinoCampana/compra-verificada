/**
 * Batch offline: embeddings + clustering semántico (DBSCAN) → `results.product_key` / `product_cluster_id`.
 * El agrupamiento exige además la misma medida en el título cuando existe (`160x200` vs `200x200`), no solo embedding cercano.
 *
 * Uso (desde carpeta `server/`, con .env cargado):
 *   npx tsx scripts/clusterProducts.ts --article=Microondas --days=60
 *   npx tsx scripts/clusterProducts.ts --article=Colchón --days=30 --embed-only
 *   npx tsx scripts/clusterProducts.ts --article=TV --days=45 --cluster-only --similarity=0.9 --min-pts=2
 *   npx tsx scripts/clusterProducts.ts --article=Microondas --days=90 --cluster-only --reset-article-window
 *
 * Requiere: PostgreSQL con extensión `vector`, OPENAI_API_KEY, columnas aplicadas (ensureSchema / schema.sql).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db.js";
import { runProductClusteringJob } from "../src/jobs/productClusteringJob.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const article = argValue("article");
  if (!article || article.length < 2) {
    console.error("Uso: --article=Texto (match ILIKE en articles.article)");
    process.exit(1);
  }
  const days = Math.min(120, Math.max(7, Number(argValue("days") ?? "60")));
  const limit = Math.min(20_000, Math.max(100, Number(argValue("limit") ?? "8000")));
  const batchSize = Math.min(100, Math.max(1, Number(argValue("batch-size") ?? "40")));
  const minSimilarity = Math.min(0.999, Math.max(0.5, Number(argValue("similarity") ?? "0.9")));
  const minPts = Math.min(20, Math.max(2, Number(argValue("min-pts") ?? "2")));
  const embedOnly = hasFlag("embed-only");
  const clusterOnly = hasFlag("cluster-only");
  const resetScope = hasFlag("reset-scope");
  const resetArticleWindow = hasFlag("reset-article-window");

  if (embedOnly && clusterOnly) {
    console.error("No usar --embed-only y --cluster-only a la vez.");
    process.exit(1);
  }

  try {
    await runProductClusteringJob(pool, {
      article,
      days,
      limit,
      batchSize,
      minSimilarity,
      minPts,
      embedOnly,
      clusterOnly,
      resetScope,
      resetArticleWindow,
    });
    console.log("[batch] listo (meta en configs id=100; también desde Operación en la web).");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
