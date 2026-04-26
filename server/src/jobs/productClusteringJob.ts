import type { Pool } from "pg";
import type { ClusterBatchMetaPayload } from "../clusterBatchMeta.js";
import { writeClusterBatchMeta } from "../clusterBatchMeta.js";
import {
  fetchEmbeddingsBatch,
  fetchResultsMissingEmbeddings,
  normalizeTitleForEmbedding,
  upsertResultEmbedding,
} from "../services/embeddingService.js";

export type ProductClusteringJobInput = {
  article: string;
  days?: number;
  limit?: number;
  batchSize?: number;
  minSimilarity?: number;
  minPts?: number;
  /** Similitud mínima entre centroides (0.5–0.999). Si no se envía, se usa env o 0.92. */
  centroidMergeMinSimilarity?: number;
  /** Si no se envía, se respeta `CLUSTER_SKIP_CENTROID_MERGE` en el servidor. */
  skipCentroidMerge?: boolean;
  /** Similitud mínima entre el par más parecido de dos clusters (0.5–0.999). Por defecto = fusión centroides. */
  pairwiseMergeMinSimilarity?: number;
  /** Si no se envía, se respeta `CLUSTER_SKIP_PAIRWISE_MERGE` en el servidor. */
  skipPairwiseMerge?: boolean;
  /** Longitud mínima del token alfanumérico (con al menos un dígito) para anclar por título. */
  titleAnchorMinLen?: number;
  /** Si no se envía, se respeta `CLUSTER_SKIP_TITLE_ANCHOR_MERGE` en el servidor. */
  skipTitleAnchorMerge?: boolean;
  embedOnly?: boolean;
  clusterOnly?: boolean;
  /** Si true, borra product_key de todas las filas del artículo (ILIKE) en la ventana de días antes de DBSCAN. */
  resetArticleWindow?: boolean;
  resetScope?: boolean;
};

type ClusterRunStats = { clusteredRows: number; inCluster: number; noise: number };

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

function cosineSimilarity(a: number[], b: number[]): number {
  return 1 - cosineDistance(a, b);
}

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

/**
 * Tras DBSCAN, une componentes cuyos **centroides** tienen similitud coseno ≥ umbral.
 * Evita que dos listados casi idénticos queden en clusters distintos por cortes de densidad.
 */
function mergeClustersByCentroid(
  labels: number[],
  points: number[][],
  mergeMinSimilarity: number,
): number[] {
  const n = labels.length;
  const clusterIds = [...new Set(labels.filter((l) => l >= 0))].sort((a, b) => a - b);
  if (clusterIds.length <= 1) return labels;

  const mergeDistMax = 1 - mergeMinSimilarity;
  const dim = points[0]!.length;

  function centroidFor(clusterId: number): number[] {
    const acc = new Array(dim).fill(0);
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== clusterId) continue;
      cnt++;
      for (let d = 0; d < dim; d++) acc[d] += points[i]![d]!;
    }
    if (cnt === 0) return acc;
    return acc.map((x) => x / cnt);
  }

  const centroids = new Map<number, number[]>();
  for (const c of clusterIds) centroids.set(c, centroidFor(c));

  const parent = new Map<number, number>();
  for (const c of clusterIds) parent.set(c, c);

  function find(x: number): number {
    let p = parent.get(x)!;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      const c1 = clusterIds[i]!;
      const c2 = clusterIds[j]!;
      const u = centroids.get(c1)!;
      const v = centroids.get(c2)!;
      if (cosineDistance(u, v) <= mergeDistMax) union(c1, c2);
    }
  }

  const roots = new Set<number>();
  for (const c of clusterIds) roots.add(find(c));
  const sortedRoots = [...roots].sort((a, b) => a - b);
  const rootToNew = new Map<number, number>();
  sortedRoots.forEach((r, idx) => rootToNew.set(r, idx));

  const out = [...labels];
  for (let i = 0; i < n; i++) {
    const L = labels[i]!;
    if (L < 0) continue;
    out[i] = rootToNew.get(find(L))!;
  }
  const mergedPairs = clusterIds.length - sortedRoots.length;
  if (mergedPairs > 0) {
    console.log(
      `[cluster] fusión por centroides: ${clusterIds.length} → ${sortedRoots.length} clusters (sim ≥ ${mergeMinSimilarity})`,
    );
  }
  return out;
}

/**
 * Une clusters si el par de listados más parecido entre ambos tiene similitud coseno ≥ umbral.
 * Evita splits cuando los centroides se “tiran” hacia otros productos pero dos títulos del mismo SKU siguen muy cercanos.
 */
function mergeClustersByMaxPairwiseSim(
  labels: number[],
  points: number[][],
  mergeMinSimilarity: number,
): number[] {
  const n = labels.length;
  const clusterIds = [...new Set(labels.filter((l) => l >= 0))].sort((a, b) => a - b);
  if (clusterIds.length <= 1) return labels;

  const byCluster = new Map<number, number[]>();
  for (const c of clusterIds) byCluster.set(c, []);
  for (let i = 0; i < n; i++) {
    const L = labels[i]!;
    if (L < 0) continue;
    byCluster.get(L)!.push(i);
  }

  const parent = new Map<number, number>();
  for (const c of clusterIds) parent.set(c, c);

  function find(x: number): number {
    let p = parent.get(x)!;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      const c1 = clusterIds[i]!;
      const c2 = clusterIds[j]!;
      const idx1 = byCluster.get(c1)!;
      const idx2 = byCluster.get(c2)!;
      let maxSim = -1;
      for (const ia of idx1) {
        const pa = points[ia]!;
        for (const ib of idx2) {
          const s = cosineSimilarity(pa, points[ib]!);
          if (s > maxSim) maxSim = s;
        }
      }
      if (maxSim >= mergeMinSimilarity) union(c1, c2);
    }
  }

  const roots = new Set<number>();
  for (const c of clusterIds) roots.add(find(c));
  const sortedRoots = [...roots].sort((a, b) => a - b);
  const rootToNew = new Map<number, number>();
  sortedRoots.forEach((r, idx) => rootToNew.set(r, idx));

  const out = [...labels];
  for (let i = 0; i < n; i++) {
    const L = labels[i]!;
    if (L < 0) continue;
    out[i] = rootToNew.get(find(L))!;
  }
  const merged = clusterIds.length - sortedRoots.length;
  if (merged > 0) {
    console.log(
      `[cluster] fusión por par máximo entre clusters: ${clusterIds.length} → ${sortedRoots.length} (sim ≥ ${mergeMinSimilarity})`,
    );
  }
  return out;
}

/**
 * Une clusters que comparten un mismo “código” en el título (alfanumérico largo con dígito),
 * p. ej. MATDGB23UAP en dos publicaciones distintas cuando el embedding no las acerca lo suficiente.
 */
function mergeClustersBySharedTitleAnchors(
  labels: number[],
  titles: (string | null)[],
  minTokenLen: number,
): number[] {
  const n = labels.length;
  const clusterIds = [...new Set(labels.filter((l) => l >= 0))].sort((a, b) => a - b);
  if (clusterIds.length <= 1) return labels;

  function anchors(title: string | null): string[] {
    if (!title) return [];
    const upper = title.toUpperCase();
    const parts = upper.match(/[A-Z0-9]+/g) ?? [];
    return [...new Set(parts)].filter((tok) => tok.length >= minTokenLen && /[0-9]/.test(tok));
  }

  const tokenToClusters = new Map<string, Set<number>>();
  for (let i = 0; i < n; i++) {
    const L = labels[i]!;
    if (L < 0) continue;
    for (const tok of anchors(titles[i]!)) {
      if (!tokenToClusters.has(tok)) tokenToClusters.set(tok, new Set());
      tokenToClusters.get(tok)!.add(L);
    }
  }

  const parent = new Map<number, number>();
  for (const c of clusterIds) parent.set(c, c);

  function find(x: number): number {
    let p = parent.get(x)!;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const [_tok, set] of tokenToClusters) {
    if (set.size < 2) continue;
    const arr = [...set];
    const c0 = arr[0]!;
    for (let k = 1; k < arr.length; k++) {
      union(c0, arr[k]!);
    }
  }

  const roots = new Set<number>();
  for (const c of clusterIds) roots.add(find(c));
  const sortedRoots = [...roots].sort((a, b) => a - b);
  const rootToNew = new Map<number, number>();
  sortedRoots.forEach((r, idx) => rootToNew.set(r, idx));

  const out = [...labels];
  for (let i = 0; i < n; i++) {
    const L = labels[i]!;
    if (L < 0) continue;
    out[i] = rootToNew.get(find(L))!;
  }
  const reduced = clusterIds.length - sortedRoots.length;
  if (reduced > 0) {
    console.log(
      `[cluster] fusión por código en título (≥${minTokenLen} chars, con dígito): ${clusterIds.length} → ${sortedRoots.length} clusters`,
    );
  }
  return out;
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

async function runEmbed(
  pool: Pool,
  opts: { article: string; days: number; limit: number; batchSize: number },
): Promise<number> {
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

function envSkipCentroidMerge(): boolean {
  return (
    process.env.CLUSTER_SKIP_CENTROID_MERGE === "1" ||
    process.env.CLUSTER_SKIP_CENTROID_MERGE === "true"
  );
}

function envCentroidMergeMinSimilarity(): number {
  const rawMerge = process.env.CLUSTER_CENTROID_MERGE_MIN_SIMILARITY?.trim();
  const parsed = rawMerge ? Number(rawMerge) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(0.999, Math.max(0.5, parsed))
    : 0.92;
}

function envSkipPairwiseMerge(): boolean {
  return (
    process.env.CLUSTER_SKIP_PAIRWISE_MERGE === "1" ||
    process.env.CLUSTER_SKIP_PAIRWISE_MERGE === "true"
  );
}

function envSkipTitleAnchorMerge(): boolean {
  return (
    process.env.CLUSTER_SKIP_TITLE_ANCHOR_MERGE === "1" ||
    process.env.CLUSTER_SKIP_TITLE_ANCHOR_MERGE === "true"
  );
}

function envTitleAnchorMinLen(): number {
  const raw = process.env.CLUSTER_TITLE_ANCHOR_MIN_LEN?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 10;
  return Math.min(24, Math.max(8, Math.round(n)));
}

async function runCluster(
  pool: Pool,
  opts: {
    article: string;
    days: number;
    limit: number;
    minSimilarity: number;
    minPts: number;
    resetScope: boolean;
    resetArticleWindow: boolean;
    skipCentroidMerge: boolean;
    centroidMergeMinSimilarity: number;
    skipPairwiseMerge: boolean;
    pairwiseMergeMinSimilarity: number;
    skipTitleAnchorMerge: boolean;
    titleAnchorMinLen: number;
  },
): Promise<ClusterRunStats> {
  const eps = 1 - opts.minSimilarity;
  const pattern = `%${opts.article}%`;

  if (opts.resetArticleWindow) {
    const { rowCount } = await pool.query(
      `
      UPDATE results r
      SET product_key = NULL,
          product_cluster_id = NULL,
          product_confidence = NULL
      FROM scrape_runs sr,
           articles a
      WHERE r.scrape_run_id = sr.id
        AND r.search_id = a.id
        AND a.enabled = TRUE
        AND a.article ILIKE $1
        AND sr.executed_at >= NOW() - ($2::int * interval '1 day')
      `,
      [pattern, opts.days],
    );
    console.log(
      `[cluster] reset amplio (artículo+ventana): ${rowCount ?? 0} filas sin product_key antes de reagrupar.`,
    );
  }

  const { rows } = await pool.query<{ id: number; emb_text: string; title: string | null }>(
    `
    SELECT r.id, e.embedding::text AS emb_text, r.title
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
    console.log("[cluster] sin filas con embedding en el universo; ejecutá embed o ampliá ventana.");
    return { clusteredRows: 0, inCluster: 0, noise: 0 };
  }

  const points: number[][] = [];
  const ids: number[] = [];
  const titles: (string | null)[] = [];
  for (const row of rows) {
    const vec = parseVectorText(row.emb_text);
    if (vec.length === 0) {
      console.warn(`[cluster] no se pudo parsear embedding para result_id=${row.id}, skip`);
      continue;
    }
    points.push(vec);
    ids.push(row.id);
    titles.push(row.title);
  }
  if (points.length < opts.minPts) {
    console.log(`[cluster] muy pocas filas (${points.length}) < minPts=${opts.minPts}, abort.`);
    return { clusteredRows: 0, inCluster: 0, noise: 0 };
  }

  if (opts.resetScope) {
    await pool.query(
      `UPDATE results r
       SET product_key = NULL, product_cluster_id = NULL, product_confidence = NULL
       WHERE r.id = ANY($1::bigint[])`,
      [ids],
    );
    console.log(`[cluster] reset de claves en ${ids.length} filas a agrupar.`);
  }

  let labels = dbscanCosine(points, eps, opts.minPts);
  if (!opts.skipCentroidMerge) {
    labels = mergeClustersByCentroid(labels, points, opts.centroidMergeMinSimilarity);
  }
  if (!opts.skipPairwiseMerge) {
    labels = mergeClustersByMaxPairwiseSim(labels, points, opts.pairwiseMergeMinSimilarity);
  }
  if (!opts.skipTitleAnchorMerge) {
    labels = mergeClustersBySharedTitleAnchors(labels, titles, opts.titleAnchorMinLen);
  }
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
      await client.query(
        `UPDATE results SET product_key = $2, product_cluster_id = $3, product_confidence = $4 WHERE id = $1`,
        [id, productKey, lab, 1],
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

function normalizeJobInput(raw: ProductClusteringJobInput): Required<
  Omit<ProductClusteringJobInput, "article">
> & { article: string } {
  const article = raw.article.trim();
  const days = Math.min(120, Math.max(7, Number(raw.days ?? 60)));
  const limit = Math.min(20_000, Math.max(100, Number(raw.limit ?? 8000)));
  const batchSize = Math.min(100, Math.max(1, Number(raw.batchSize ?? 40)));
  const minSimilarity = Math.min(0.999, Math.max(0.5, Number(raw.minSimilarity ?? 0.9)));
  const minPts = Math.min(20, Math.max(2, Number(raw.minPts ?? 2)));
  const skipCentroidMerge =
    raw.skipCentroidMerge === true ? true : raw.skipCentroidMerge === false ? false : envSkipCentroidMerge();
  const parsedMerge =
    raw.centroidMergeMinSimilarity !== undefined ? Number(raw.centroidMergeMinSimilarity) : NaN;
  const centroidMergeMinSimilarity =
    Number.isFinite(parsedMerge) && parsedMerge > 0
      ? Math.min(0.999, Math.max(0.5, parsedMerge))
      : envCentroidMergeMinSimilarity();
  const parsedPairwise =
    raw.pairwiseMergeMinSimilarity !== undefined ? Number(raw.pairwiseMergeMinSimilarity) : NaN;
  const pairwiseMergeMinSimilarity =
    Number.isFinite(parsedPairwise) && parsedPairwise > 0
      ? Math.min(0.999, Math.max(0.5, parsedPairwise))
      : centroidMergeMinSimilarity;
  const skipPairwiseMerge =
    raw.skipPairwiseMerge === true ? true : raw.skipPairwiseMerge === false ? false : envSkipPairwiseMerge();
  const parsedAnchorLen = raw.titleAnchorMinLen !== undefined ? Number(raw.titleAnchorMinLen) : NaN;
  const titleAnchorMinLen = Number.isFinite(parsedAnchorLen)
    ? Math.min(24, Math.max(8, Math.round(parsedAnchorLen)))
    : envTitleAnchorMinLen();
  const skipTitleAnchorMerge =
    raw.skipTitleAnchorMerge === true
      ? true
      : raw.skipTitleAnchorMerge === false
        ? false
        : envSkipTitleAnchorMerge();
  return {
    article,
    days,
    limit,
    batchSize,
    minSimilarity,
    minPts,
    centroidMergeMinSimilarity,
    skipCentroidMerge,
    pairwiseMergeMinSimilarity,
    skipPairwiseMerge,
    titleAnchorMinLen,
    skipTitleAnchorMerge,
    embedOnly: Boolean(raw.embedOnly),
    clusterOnly: Boolean(raw.clusterOnly),
    resetArticleWindow: Boolean(raw.resetArticleWindow),
    resetScope: Boolean(raw.resetScope),
  };
}

/**
 * Ejecuta embed + cluster y persiste meta en `configs` (id 100).
 * No cierra el pool (sirve para Express y para scripts que luego hacen pool.end).
 */
export async function runProductClusteringJob(
  pool: Pool,
  raw: ProductClusteringJobInput,
): Promise<ClusterBatchMetaPayload> {
  const opts = normalizeJobInput(raw);
  if (opts.article.length < 2) {
    throw new Error("article debe tener al menos 2 caracteres");
  }
  if (opts.embedOnly && opts.clusterOnly) {
    throw new Error("No usar embedOnly y clusterOnly a la vez");
  }

  const t0 = Date.now();
  let embedded = 0;
  let clusterStats: ClusterRunStats = { clusteredRows: 0, inCluster: 0, noise: 0 };

  if (!opts.clusterOnly) {
    embedded = await runEmbed(pool, {
      article: opts.article,
      days: opts.days,
      limit: opts.limit,
      batchSize: opts.batchSize,
    });
  }
  if (!opts.embedOnly) {
    clusterStats = await runCluster(pool, {
      article: opts.article,
      days: opts.days,
      limit: opts.limit,
      minSimilarity: opts.minSimilarity,
      minPts: opts.minPts,
      resetScope: opts.resetScope,
      resetArticleWindow: opts.resetArticleWindow,
      skipCentroidMerge: opts.skipCentroidMerge,
      centroidMergeMinSimilarity: opts.centroidMergeMinSimilarity,
      skipPairwiseMerge: opts.skipPairwiseMerge,
      pairwiseMergeMinSimilarity: opts.pairwiseMergeMinSimilarity,
      skipTitleAnchorMerge: opts.skipTitleAnchorMerge,
      titleAnchorMinLen: opts.titleAnchorMinLen,
    });
  }

  const payload: ClusterBatchMetaPayload = {
    finishedAt: new Date().toISOString(),
    article: opts.article,
    days: opts.days,
    embedded,
    clusteredRows: clusterStats.clusteredRows,
    inCluster: clusterStats.inCluster,
    noise: clusterStats.noise,
    minSimilarity: opts.minSimilarity,
    minPts: opts.minPts,
    centroidMergeMinSimilarity: opts.centroidMergeMinSimilarity,
    skipCentroidMerge: opts.skipCentroidMerge,
    pairwiseMergeMinSimilarity: opts.pairwiseMergeMinSimilarity,
    skipPairwiseMerge: opts.skipPairwiseMerge,
    titleAnchorMinLen: opts.titleAnchorMinLen,
    skipTitleAnchorMerge: opts.skipTitleAnchorMerge,
    resetArticleWindow: opts.resetArticleWindow,
    resetScope: opts.resetScope,
    durationMs: Date.now() - t0,
  };
  await writeClusterBatchMeta(pool, payload);
  console.log("[batch] meta guardada en configs id=100.");
  return payload;
}
