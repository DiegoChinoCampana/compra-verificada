import { Router } from "express";
import {
  assertClusterBatchAuthorized,
  clusterBatchRequiresClientSecret,
} from "../clusterRunAuth.js";
import { readClusterBatchMeta } from "../clusterBatchMeta.js";
import { pool } from "../db.js";
import { runProductClusteringJob } from "../jobs/productClusteringJob.js";
import { isOpenAiApiKeyConfigured } from "../services/embeddingService.js";
import { parseProductScopeQuery } from "../productScopeQuery.js";
import { RUNS_ONE_PER_DAY_CTE } from "../sql/runsOnePerDay.js";
import {
  CTE_CANONICAL_PRODUCT_TITLE,
  sqlProductGroupingKey,
  sqlWhereManualProductTitleAndSeller,
  sqlWhereTitleMatchesCanonical,
} from "../sql/articleSameProductTitle.js";

export const analyticsRouter = Router();

function parseId(param: string): number | null {
  const id = Number(param);
  return Number.isInteger(id) ? id : null;
}

/** Alcance: automático (moda entre corridas) o manual (`productTitle` + opcional `seller`). */
analyticsRouter.get("/article/:articleId/analytics-scope", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  if (pq.manual) {
    const { rows } = await pool.query(
      `SELECT trim(both from regexp_replace(lower(trim($1::text)), E'\\\\s+', ' ', 'g')) AS norm_title`,
      [pq.productTitle],
    );
    const norm = (rows[0] as { norm_title: string } | undefined)?.norm_title ?? "";
    res.json({
      hasCanonicalProduct: Boolean(norm),
      scopeMode: "manual" as const,
      canonicalNormTitle: norm || null,
      displayTitle: pq.productTitle,
      sellerFilter: pq.sellerOrNull,
    });
    return;
  }
  const sql = `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
    SELECT norm_title, display_title FROM canonical_norm_title
  `;
  const { rows } = await pool.query(sql, [articleId]);
  const row = rows[0] as { norm_title: string; display_title: string | null } | undefined;
  res.json({
    hasCanonicalProduct: Boolean(row?.norm_title),
    scopeMode: "auto" as const,
    canonicalNormTitle: row?.norm_title ?? null,
    displayTitle: row?.display_title ?? null,
    sellerFilter: null,
  });
});

analyticsRouter.get("/article/:articleId/price-series", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  const mf = sqlWhereManualProductTitleAndSeller("r", 2, 3);
  const af = sqlWhereTitleMatchesCanonical("r");
  const sql = pq.manual
    ? `
    WITH
    ${RUNS_ONE_PER_DAY_CTE.trim()}
    SELECT
      sr.id AS scrape_run_id,
      sr.executed_at,
      MIN(r.price)::float8 AS min_price,
      AVG(r.price)::float8 AS avg_price,
      COUNT(*)::int AS listing_count
    FROM results r
    JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
    WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mf}
    GROUP BY sr.id, sr.executed_at
    ORDER BY sr.executed_at ASC
  `
    : `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
    SELECT
      sr.id AS scrape_run_id,
      sr.executed_at,
      MIN(r.price)::float8 AS min_price,
      AVG(r.price)::float8 AS avg_price,
      COUNT(*)::int AS listing_count
    FROM results r
    JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
    WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${af}
    GROUP BY sr.id, sr.executed_at
    ORDER BY sr.executed_at ASC
  `;
  const params = pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId];
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

analyticsRouter.get("/article/:articleId/best-per-run", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  const mf = sqlWhereManualProductTitleAndSeller("r", 2, 3);
  const af = sqlWhereTitleMatchesCanonical("r");
  const sql = pq.manual
    ? `
    WITH
    ${RUNS_ONE_PER_DAY_CTE.trim()},
    ranked AS (
      SELECT
        sr.id AS scrape_run_id,
        sr.executed_at,
        r.title,
        r.price::float8 AS price,
        r.url,
        r.seller,
        r.rating::float8 AS rating,
        ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
      FROM results r
      JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
      WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mf}
    )
    SELECT scrape_run_id, executed_at, title, price, url, seller, rating
    FROM ranked WHERE rn = 1 ORDER BY executed_at ASC
  `
    : `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()},
    ranked AS (
      SELECT
        sr.id AS scrape_run_id,
        sr.executed_at,
        r.title,
        r.price::float8 AS price,
        r.url,
        r.seller,
        r.rating::float8 AS rating,
        ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
      FROM results r
      JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
      WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${af}
    )
    SELECT scrape_run_id, executed_at, title, price, url, seller, rating
    FROM ranked WHERE rn = 1 ORDER BY executed_at ASC
  `;
  const params = pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId];
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

analyticsRouter.get("/article/:articleId/dispersion", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  const mf = sqlWhereManualProductTitleAndSeller("r", 2, 3);
  const af = sqlWhereTitleMatchesCanonical("r");
  const sql = pq.manual
    ? `
    WITH
    ${RUNS_ONE_PER_DAY_CTE.trim()}
    SELECT
      sr.id AS scrape_run_id,
      sr.executed_at,
      MIN(r.price)::float8 AS min_price,
      MAX(r.price)::float8 AS max_price,
      AVG(r.price)::float8 AS avg_price,
      STDDEV_POP(r.price)::float8 AS stddev_pop,
      COUNT(*)::int AS listing_count
    FROM results r
    JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
    WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mf}
    GROUP BY sr.id, sr.executed_at
    ORDER BY sr.executed_at ASC
  `
    : `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
    SELECT
      sr.id AS scrape_run_id,
      sr.executed_at,
      MIN(r.price)::float8 AS min_price,
      MAX(r.price)::float8 AS max_price,
      AVG(r.price)::float8 AS avg_price,
      STDDEV_POP(r.price)::float8 AS stddev_pop,
      COUNT(*)::int AS listing_count
    FROM results r
    JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
    WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${af}
    GROUP BY sr.id, sr.executed_at
    ORDER BY sr.executed_at ASC
  `;
  const params = pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId];
  const { rows } = await pool.query(sql, params);
  const enriched = rows.map((row: Record<string, unknown>) => {
    const avg = row.avg_price as number | null;
    const std = row.stddev_pop as number | null;
    const cv =
      avg && avg > 0 && std != null && Number.isFinite(std) ? std / avg : null;
    return { ...row, coefficient_of_variation: cv };
  });
  res.json(enriched);
});

analyticsRouter.get("/article/:articleId/sellers", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
  const pq = parseProductScopeQuery(req);
  const mf = sqlWhereManualProductTitleAndSeller("results", 3, 4);
  const af = sqlWhereTitleMatchesCanonical("results");
  const sql = pq.manual
    ? `
    SELECT
      COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
      COUNT(*)::int AS listing_count,
      AVG(results.rating)::float8 AS avg_rating,
      MIN(results.price)::float8 AS min_price_seen,
      MAX(results.created_at) AS last_seen_at
    FROM results
    WHERE results.search_id = $1
      AND results.created_at > NOW() - ($2::int * interval '1 day')
      AND ${mf}
    GROUP BY 1
    ORDER BY listing_count DESC
    LIMIT 30
  `
    : `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
    SELECT
      COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
      COUNT(*)::int AS listing_count,
      AVG(results.rating)::float8 AS avg_rating,
      MIN(results.price)::float8 AS min_price_seen,
      MAX(results.created_at) AS last_seen_at
    FROM results
    WHERE results.search_id = $1
      AND results.created_at > NOW() - ($2::int * interval '1 day')
      AND ${af}
    GROUP BY 1
    ORDER BY listing_count DESC
    LIMIT 30
  `;
  const params = pq.manual
    ? [articleId, days, pq.productTitle, pq.sellerOrNull]
    : [articleId, days];
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

analyticsRouter.get("/article/:articleId/criteria", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  const mf = sqlWhereManualProductTitleAndSeller("results", 2, 3);
  const af = sqlWhereTitleMatchesCanonical("results");
  const sql = pq.manual
    ? `
    SELECT
      COUNT(*)::int AS total_results,
      COUNT(*) FILTER (WHERE results.official_store_required IS TRUE)::int AS required_official_count,
      COUNT(*) FILTER (
        WHERE results.official_store_required IS TRUE AND results.official_store_applied IS TRUE
      )::int AS official_met_count,
      COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE)::int AS required_free_ship_count,
      COUNT(*) FILTER (
        WHERE results.free_shipping_required IS TRUE AND results.free_shipping_applied IS TRUE
      )::int AS free_ship_met_count
    FROM results
    WHERE results.search_id = $1 AND ${mf}
  `
    : `
    WITH
    ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
    SELECT
      COUNT(*)::int AS total_results,
      COUNT(*) FILTER (WHERE results.official_store_required IS TRUE)::int AS required_official_count,
      COUNT(*) FILTER (
        WHERE results.official_store_required IS TRUE AND results.official_store_applied IS TRUE
      )::int AS official_met_count,
      COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE)::int AS required_free_ship_count,
      COUNT(*) FILTER (
        WHERE results.free_shipping_required IS TRUE AND results.free_shipping_applied IS TRUE
      )::int AS free_ship_met_count
    FROM results
    WHERE results.search_id = $1 AND ${af}
  `;
  const params = pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId];
  const { rows } = await pool.query(sql, params);
  res.json(rows[0] ?? {});
});

analyticsRouter.get("/operational/stale-scrapes", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const sql = `
    SELECT id, article, brand, detail, last_scraped_at, enabled
    FROM articles
    WHERE enabled = TRUE
      AND (
        last_scraped_at IS NULL
        OR last_scraped_at < NOW() - ($1::int * interval '1 day')
      )
    ORDER BY last_scraped_at NULLS FIRST
    LIMIT 200
  `;
  const { rows } = await pool.query(sql, [days]);
  res.json(rows);
});

analyticsRouter.get("/operational/missing-recent-results", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  const sql = `
    SELECT a.id, a.article, a.brand, a.detail, a.last_scraped_at
    FROM articles a
    WHERE a.enabled = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM results r
        WHERE r.search_id = a.id
          AND r.created_at > NOW() - ($1::int * interval '1 day')
      )
    ORDER BY a.id
    LIMIT 200
  `;
  const { rows } = await pool.query(sql, [days]);
  res.json(rows);
});

/** Última corrida del script `clusterProducts.ts` + conteos (para pantalla Operación). */
analyticsRouter.get("/operational/product-clustering-meta", async (_req, res) => {
  const lastRun = await readClusterBatchMeta(pool);
  try {
    const { rows } = await pool.query<{
      with_product_key: number;
      with_embedding: number;
      total_results: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM results r
         WHERE r.product_key IS NOT NULL AND length(trim(r.product_key)) > 0) AS with_product_key,
        (SELECT COUNT(*)::int FROM result_embeddings) AS with_embedding,
        (SELECT COUNT(*)::int FROM results) AS total_results
    `);
    res.json({
      lastRun,
      counts: rows[0] ?? null,
      requiresClusterBatchSecret: clusterBatchRequiresClientSecret(),
      openAiConfigured: isOpenAiApiKeyConfigured(),
    });
  } catch (e) {
    res.json({
      lastRun,
      counts: null,
      countsError: e instanceof Error ? e.message : String(e),
      requiresClusterBatchSecret: clusterBatchRequiresClientSecret(),
      openAiConfigured: isOpenAiApiKeyConfigured(),
    });
  }
});

type ClusterRunBody = {
  article?: unknown;
  secret?: unknown;
  days?: unknown;
  limit?: unknown;
  batchSize?: unknown;
  minSimilarity?: unknown;
  minPts?: unknown;
  centroidMergeMinSimilarity?: unknown;
  skipCentroidMerge?: unknown;
  pairwiseMergeMinSimilarity?: unknown;
  skipPairwiseMerge?: unknown;
  titleAnchorMinLen?: unknown;
  skipTitleAnchorMerge?: unknown;
  embedOnly?: unknown;
  clusterOnly?: unknown;
  resetArticleWindow?: unknown;
  resetScope?: unknown;
};

analyticsRouter.post("/operational/product-clustering-run", async (req, res) => {
  try {
    const headerSecret = req.headers["x-cluster-batch-secret"];
    const body = (req.body ?? {}) as ClusterRunBody;
    const secret =
      (typeof headerSecret === "string" ? headerSecret : Array.isArray(headerSecret) ? headerSecret[0] : undefined) ??
      body.secret;
    assertClusterBatchAuthorized(secret);

    const article = typeof body.article === "string" ? body.article.trim() : "";
    if (article.length < 2) {
      res.status(400).json({ error: "body.article es obligatorio (mín. 2 caracteres)" });
      return;
    }

    const payload = await runProductClusteringJob(pool, {
      article,
      days: body.days !== undefined ? Number(body.days) : undefined,
      limit: body.limit !== undefined ? Number(body.limit) : undefined,
      batchSize: body.batchSize !== undefined ? Number(body.batchSize) : undefined,
      minSimilarity: body.minSimilarity !== undefined ? Number(body.minSimilarity) : undefined,
      minPts: body.minPts !== undefined ? Number(body.minPts) : undefined,
      centroidMergeMinSimilarity:
        body.centroidMergeMinSimilarity !== undefined
          ? Number(body.centroidMergeMinSimilarity)
          : undefined,
      skipCentroidMerge:
        body.skipCentroidMerge === true
          ? true
          : body.skipCentroidMerge === false
            ? false
            : undefined,
      pairwiseMergeMinSimilarity:
        body.pairwiseMergeMinSimilarity !== undefined
          ? Number(body.pairwiseMergeMinSimilarity)
          : undefined,
      skipPairwiseMerge:
        body.skipPairwiseMerge === true
          ? true
          : body.skipPairwiseMerge === false
            ? false
            : undefined,
      titleAnchorMinLen: body.titleAnchorMinLen !== undefined ? Number(body.titleAnchorMinLen) : undefined,
      skipTitleAnchorMerge:
        body.skipTitleAnchorMerge === true
          ? true
          : body.skipTitleAnchorMerge === false
            ? false
            : undefined,
      embedOnly: body.embedOnly === true,
      clusterOnly: body.clusterOnly === true,
      resetArticleWindow: body.resetArticleWindow === true,
      resetScope: body.resetScope === true,
    });
    res.json({ ok: true as const, result: payload });
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? Number((e as { status: number }).status) : 0;
    const code = status >= 400 && status < 600 ? status : 500;
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cluster-run]", e);
    res.status(code).json({ ok: false as const, error: message });
  }
});

const PEERS_AUTO_SQL = `
    WITH grp AS (
      SELECT id, article, brand, detail, enabled
      FROM articles
      WHERE lower(trim(article)) = lower(trim($1::text))
        AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($2::text, '')))
    ),
    per_article_run AS (
      SELECT
        g.id AS article_id,
        sr.id AS run_id,
        sr.executed_at,
        MIN(r.price) AS min_p
      FROM grp g
      LEFT JOIN LATERAL (
        WITH rod AS (
          SELECT DISTINCT ON (date_trunc('day', sr2.executed_at))
            sr2.id AS scrape_run_id,
            sr2.executed_at
          FROM results r2
          INNER JOIN scrape_runs sr2 ON sr2.id = r2.scrape_run_id
          WHERE r2.search_id = g.id AND r2.price IS NOT NULL
          ORDER BY date_trunc('day', sr2.executed_at), sr2.executed_at DESC
        ),
        per_run_price_rank AS (
          SELECT
            sr2.id AS scrape_run_id,
            sr2.executed_at,
            ${sqlProductGroupingKey("r2")} AS norm_title,
            r2.price,
            ROW_NUMBER() OVER (PARTITION BY sr2.id ORDER BY r2.price ASC NULLS LAST) AS rn
          FROM results r2
          INNER JOIN scrape_runs sr2 ON sr2.id = r2.scrape_run_id
          INNER JOIN rod ON rod.scrape_run_id = sr2.id
          WHERE r2.search_id = g.id AND r2.price IS NOT NULL
        ),
        canonical_norm_title AS (
          SELECT pr.norm_title
          FROM per_run_price_rank pr
          WHERE pr.rn = 1 AND pr.norm_title <> ''
          GROUP BY pr.norm_title
          ORDER BY COUNT(*) DESC, MAX(pr.executed_at) DESC
          LIMIT 1
        )
        SELECT norm_title FROM canonical_norm_title
      ) canon ON true
      INNER JOIN results r ON r.search_id = g.id AND r.price IS NOT NULL
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      WHERE canon.norm_title IS NULL
        OR ${sqlProductGroupingKey("r")} = canon.norm_title
      GROUP BY g.id, sr.id, sr.executed_at
    ),
    per_day AS (
      SELECT DISTINCT ON (p.article_id, date_trunc('day', p.executed_at))
        p.article_id,
        p.executed_at,
        p.min_p
      FROM per_article_run p
      ORDER BY p.article_id, date_trunc('day', p.executed_at), p.executed_at DESC
    ),
    latest AS (
      SELECT DISTINCT ON (article_id)
        article_id,
        executed_at,
        min_p
      FROM per_day
      ORDER BY article_id, executed_at DESC
    )
    SELECT
      g.id,
      g.article,
      g.brand,
      g.detail,
      g.enabled,
      l.min_p::float8 AS latest_run_min_price,
      l.executed_at AS latest_run_at
    FROM grp g
    LEFT JOIN latest l ON l.article_id = g.id
    WHERE ($3::int IS NULL OR g.id <> $3)
    ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
`;

const PEERS_MANUAL_SQL = `
    WITH grp AS (
      SELECT id, article, brand, detail, enabled
      FROM articles
      WHERE lower(trim(article)) = lower(trim($1::text))
        AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($2::text, '')))
    ),
    per_article_run AS (
      SELECT
        g.id AS article_id,
        sr.id AS run_id,
        sr.executed_at,
        MIN(r.price) AS min_p
      FROM grp g
      INNER JOIN results r ON r.search_id = g.id AND r.price IS NOT NULL
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      WHERE ${sqlWhereManualProductTitleAndSeller("r", 4, 5)}
      GROUP BY g.id, sr.id, sr.executed_at
    ),
    per_day AS (
      SELECT DISTINCT ON (p.article_id, date_trunc('day', p.executed_at))
        p.article_id,
        p.executed_at,
        p.min_p
      FROM per_article_run p
      ORDER BY p.article_id, date_trunc('day', p.executed_at), p.executed_at DESC
    ),
    latest AS (
      SELECT DISTINCT ON (article_id)
        article_id,
        executed_at,
        min_p
      FROM per_day
      ORDER BY article_id, executed_at DESC
    )
    SELECT
      g.id,
      g.article,
      g.brand,
      g.detail,
      g.enabled,
      l.min_p::float8 AS latest_run_min_price,
      l.executed_at AS latest_run_at
    FROM grp g
    LEFT JOIN latest l ON l.article_id = g.id
    WHERE ($3::int IS NULL OR g.id <> $3)
    ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
`;

analyticsRouter.get("/peers/by-article-detail", async (req, res) => {
  const article = typeof req.query.article === "string" ? req.query.article.trim() : "";
  const detail = typeof req.query.detail === "string" ? req.query.detail.trim() : "";
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!article) {
    res.status(400).json({ error: "Query param article is required" });
    return;
  }
  const pq = parseProductScopeQuery(req);
  const sql = pq.manual ? PEERS_MANUAL_SQL : PEERS_AUTO_SQL;
  const params = pq.manual
    ? [article, detail, excludeId, pq.productTitle, pq.sellerOrNull]
    : [article, detail, excludeId];
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});
