/**
 * Batch offline: embeddings + clustering semántico (DBSCAN) → `results.product_key` / `product_cluster_id`.
 *
 * Uso (desde carpeta `server/`, con .env cargado):
 *   npx tsx scripts/clusterProducts.ts --article=Microondas --days=60
 *   npx tsx scripts/clusterProducts.ts --article=Colchón --days=30 --embed-only
 *   npx tsx scripts/clusterProducts.ts --article=TV --days=45 --cluster-only --similarity=0.9 --min-pts=3
 *
 * Requiere: PostgreSQL con extensión `vector`, OPENAI_API_KEY, columnas aplicadas (ensureSchema / schema.sql).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { writeClusterBatchMeta } from "../src/clusterBatchMeta.js";
import { pool } from "../src/db.js";
import {
  fetchEmbeddingsBatch,
  fetchResultsMissingEmbeddings,
  normalizeTitleForEmbedding,
  upsertResultEmbedding,
} from "../src/services/embeddingService.js";

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

/** Distancia coseno = 1 - cos_sim; vectores no necesariamente normalizados. */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= 0) return 1;
  return 1 - dot / denom;
}

/**
 * DBSCAN con distancia coseno. `eps` = umbral de distancia (ej. 0.1 ≈ similitud ≥ 0.9).
 * Retorna etiquetas: 0..k-1 cluster, -1 ruido.
 */
function dbscanCosine(points: number[][], eps: number, minPts: number): number[] {
  const n = points.length;
  const UNDEF = -2;
  const NOISE = -1;
  const labels = new Array<number>(n).fill(UNDEF);

  function region(i: number): number[] {
    const out: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (cosineDistance(points[i]!, points[j]!) <= eps) out.push(j);
    }
    return out;
  }

  function regionSize(i: number, neigh: number[]): number {
    return neigh.length + 1;
  }

  let cluster = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNDEF) continue;
    const neigh = region(i);
    if (regionSize(i, neigh) < minPts) {
      labels[i] = NOISE;
      continue;
    }
    labels[i] = cluster;
    const seeds = [...neigh];
    while (seeds.length) {
      const q = seeds.pop()!;
      if (labels[q] === NOISE) labels[q] = cluster;
      if (labels[q] !== UNDEF) continue;
      labels[q] = cluster;
      const nq = region(q);
      if (regionSize(q, nq) >= minPts) {
        for (const p of nq) {
          if (labels[p] === UNDEF || labels[p] === NOISE) seeds.push(p);
        }
      }
    }
    cluster += 1;
  }
  return labels;
}

function parseVectorText(raw: string): number[] {
  const s = raw.trim();
  try {
    const j = JSON.parse(s.replace(/^\(/, "[").replace(/\)$/, "]")) as unknown;
    if (Array.isArray(j) && j.every((x) => typeof x === "number")) return j as number[];
  } catch {
    /* seguir */
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(",").map((x) => Number.parseFloat(x.trim()));
  }
  return [];
}

async function runEmbed(opts: {
  article: string;
  days: number;
  limit: number;
  batchSize: number;
}): Promise<number> {
  const missing = await fetchResultsMissingEmbeddings(pool, {
    articleIlike: opts.article,
    days: opts.days,
    limit: opts.limit,
  });
  console.log(`[embed] pendientes: ${missing.length} (article ~ ${opts.article}, ${opts.days} días)`);
  let done = 0;
  for (let i = 0; i < missing.length; i += opts.batchSize) {
    const chunk = missing.slice(i, i + opts.batchSize);
    const texts = chunk.map((r) => normalizeTitleForEmbedding(r.title));
    const vectors = await fetchEmbeddingsBatch(texts);
    for (let k = 0; k < chunk.length; k++) {
      await upsertResultEmbedding(pool, chunk[k]!.id, vectors[k]!);
    }
    done += chunk.length;
    console.log(`[embed] guardados ${done} / ${missing.length}`);
  }
  return done;
}

type ClusterRunStats = { clusteredRows: number; inCluster: number; noise: number };

async function runCluster(opts: {
  article: string;
  days: number;
  limit: number;
  minSimilarity: number;
  minPts: number;
  resetScope: boolean;
}): Promise<ClusterRunStats> {
  const eps = 1 - opts.minSimilarity;
  const pattern = `%${opts.article}%`;

  const { rows } = await pool.query<{ id: number; emb_text: string }>(
    `
    SELECT r.id, e.embedding::text AS emb_text
    FROM results r
    INNER JOIN result_embeddings e ON e.result_id = r.id
    INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    INNER JOIN articles a ON a.id = r.search_id
    WHERE a.enabled = TRUE
      AND a.article ILIKE $1
      AND sr.executed_at >= NOW() - ($2::int * interval '1 day')
    ORDER BY r.id
    LIMIT $3
    `,
    [pattern, opts.days, opts.limit],
  );

  if (rows.length === 0) {
    console.log("[cluster] sin filas con embedding en el universo; ejecutá --embed o ampliá ventana.");
    return { clusteredRows: 0, inCluster: 0, noise: 0 };
  }

  const points: number[][] = [];
  const ids: number[] = [];
  for (const row of rows) {
    const vec = parseVectorText(row.emb_text);
    if (vec.length === 0) {
      console.warn(`[cluster] no se pudo parsear embedding para result_id=${row.id}, skip`);
      continue;
    }
    points.push(vec);
    ids.push(row.id);
  }
  if (points.length < opts.minPts) {
    console.log(`[cluster] muy pocas filas (${points.length}) < minPts=${opts.minPts}, abort.`);
    return { clusteredRows: 0, inCluster: 0, noise: 0 };
  }

  if (opts.resetScope) {
    await pool.query(
      `
      UPDATE results r
      SET product_key = NULL, product_cluster_id = NULL, product_confidence = NULL
      WHERE r.id = ANY($1::bigint[])
      `,
      [ids],
    );
    console.log(`[cluster] reset de claves en ${ids.length} filas a agrupar.`);
  }

  const labels = dbscanCosine(points, eps, opts.minPts);
  const slug = opts.article.replace(/\s+/g, "_").slice(0, 40);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const lab = labels[i]!;
      if (lab < 0) {
        await client.query(
          `UPDATE results SET product_key = NULL, product_cluster_id = NULL, product_confidence = 0
           WHERE id = $1`,
          [id],
        );
        continue;
      }
      const productKey = `cluster:${slug}:${lab}`;
      const conf = 1;
      await client.query(
        `UPDATE results SET product_key = $2, product_cluster_id = $3, product_confidence = $4 WHERE id = $1`,
        [id, productKey, lab, conf],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const inCluster = labels.filter((l) => l >= 0).length;
  const noise = labels.filter((l) => l === -1).length;
  console.log(
    `[cluster] listo: ${ids.length} filas, eps(dist)=${eps.toFixed(3)} (sim≥${opts.minSimilarity}), minPts=${opts.minPts}, en_cluster=${inCluster}, ruido=${noise}`,
  );
  return { clusteredRows: ids.length, inCluster, noise };
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
  const minPts = Math.min(20, Math.max(2, Number(argValue("min-pts") ?? "3")));
  const embedOnly = hasFlag("embed-only");
  const clusterOnly = hasFlag("cluster-only");
  const resetScope = hasFlag("reset-scope");

  if (embedOnly && clusterOnly) {
    console.error("No usar --embed-only y --cluster-only a la vez.");
    process.exit(1);
  }

  const t0 = Date.now();
  let embedded = 0;
  let clusterStats: ClusterRunStats = { clusteredRows: 0, inCluster: 0, noise: 0 };
  try {
    if (!clusterOnly) {
      embedded = await runEmbed({ article, days, limit, batchSize });
    }
    if (!embedOnly) {
      clusterStats = await runCluster({
        article,
        days,
        limit,
        minSimilarity,
        minPts,
        resetScope,
      });
    }
    await writeClusterBatchMeta(pool, {
      finishedAt: new Date().toISOString(),
      article,
      days,
      embedded,
      clusteredRows: clusterStats.clusteredRows,
      inCluster: clusterStats.inCluster,
      noise: clusterStats.noise,
      minSimilarity,
      minPts,
      resetScope,
      durationMs: Date.now() - t0,
    });
    console.log("[batch] meta guardada en configs id=100 (véase Operación → clustering en la web).");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
