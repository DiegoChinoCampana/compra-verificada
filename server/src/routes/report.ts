import { Router } from "express";
import { pool } from "../db.js";
import { buildRecommendation } from "../recommendation.js";
import { parseProductScopeQuery } from "../productScopeQuery.js";
import { RUNS_ONE_PER_DAY_CTE } from "../sql/runsOnePerDay.js";
import {
  CTE_CANONICAL_PRODUCT_TITLE,
  sqlProductGroupingKey,
  sqlWhereManualProductTitleAndSeller,
  sqlWhereTitleMatchesCanonical,
} from "../sql/articleSameProductTitle.js";

export const reportRouter = Router();

function parseId(param: string): number | null {
  const id = Number(param);
  return Number.isInteger(id) ? id : null;
}

const REPORT_PEERS_AUTO = `
       WITH grp AS (
         SELECT id, article, brand, detail, enabled
         FROM articles
         WHERE lower(trim(article)) = lower(trim($1::text))
           AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($2::text, '')))
       ),
       per_article_run AS (
         SELECT g.id AS article_id, sr.id AS run_id, sr.executed_at, MIN(r.price) AS min_p
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
         SELECT DISTINCT ON (article_id) article_id, executed_at, min_p
         FROM per_day
         ORDER BY article_id, executed_at DESC
       )
       SELECT g.id, g.article, g.brand, g.detail, g.enabled,
              l.min_p::float8 AS latest_run_min_price, l.executed_at AS latest_run_at
       FROM grp g
       LEFT JOIN latest l ON l.article_id = g.id
       ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST`;

const REPORT_PEERS_MANUAL = `
       WITH grp AS (
         SELECT id, article, brand, detail, enabled
         FROM articles
         WHERE lower(trim(article)) = lower(trim($1::text))
           AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($2::text, '')))
       ),
       per_article_run AS (
         SELECT g.id AS article_id, sr.id AS run_id, sr.executed_at, MIN(r.price) AS min_p
         FROM grp g
         INNER JOIN results r ON r.search_id = g.id AND r.price IS NOT NULL
         INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
         WHERE ${sqlWhereManualProductTitleAndSeller("r", 3, 4)}
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
         SELECT DISTINCT ON (article_id) article_id, executed_at, min_p
         FROM per_day
         ORDER BY article_id, executed_at DESC
       )
       SELECT g.id, g.article, g.brand, g.detail, g.enabled,
              l.min_p::float8 AS latest_run_min_price, l.executed_at AS latest_run_at
       FROM grp g
       LEFT JOIN latest l ON l.article_id = g.id
       ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST`;

reportRouter.get("/article/:articleId", async (req, res) => {
  const articleId = parseId(req.params.articleId);
  if (articleId == null) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }

  const pq = parseProductScopeQuery(req);
  const mfR = sqlWhereManualProductTitleAndSeller("r", 2, 3);
  const afR = sqlWhereTitleMatchesCanonical("r");
  const mfRes = sqlWhereManualProductTitleAndSeller("results", 2, 3);
  const afRes = sqlWhereTitleMatchesCanonical("results");

  const articleRes = await pool.query(
    `SELECT id, article, brand, detail, enabled, created_at, last_scraped_at, ordered_by,
            official_store_required, free_shipping_required
     FROM articles WHERE id = $1`,
    [articleId],
  );
  if (!articleRes.rows.length) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const article = articleRes.rows[0] as Record<string, unknown>;

  const [
    priceSeries,
    bestPerRun,
    dispersion,
    sellers,
    criteria,
    peers,
    scopeRow,
  ] = await Promise.all([
    pool.query(
      pq.manual
        ? `WITH
       ${RUNS_ONE_PER_DAY_CTE.trim()}
       SELECT sr.id AS scrape_run_id, sr.executed_at,
              MIN(r.price)::float8 AS min_price,
              AVG(r.price)::float8 AS avg_price,
              COUNT(*)::int AS listing_count
       FROM results r
       JOIN scrape_runs sr ON sr.id = r.scrape_run_id
       JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
       WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mfR}
       GROUP BY sr.id, sr.executed_at
       ORDER BY sr.executed_at ASC`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
       SELECT sr.id AS scrape_run_id, sr.executed_at,
              MIN(r.price)::float8 AS min_price,
              AVG(r.price)::float8 AS avg_price,
              COUNT(*)::int AS listing_count
       FROM results r
       JOIN scrape_runs sr ON sr.id = r.scrape_run_id
       JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
       WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${afR}
       GROUP BY sr.id, sr.executed_at
       ORDER BY sr.executed_at ASC`,
      pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
    ),
    pool.query(
      pq.manual
        ? `WITH
       ${RUNS_ONE_PER_DAY_CTE.trim()},
       ranked AS (
         SELECT sr.id AS scrape_run_id, sr.executed_at, r.title,
                r.price::float8 AS price, r.url, r.seller, r.rating::float8 AS rating,
                ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
         FROM results r
         JOIN scrape_runs sr ON sr.id = r.scrape_run_id
         JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
         WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mfR}
       )
       SELECT scrape_run_id, executed_at, title, price, url, seller, rating
       FROM ranked WHERE rn = 1 ORDER BY executed_at ASC`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()},
       ranked AS (
         SELECT sr.id AS scrape_run_id, sr.executed_at, r.title,
                r.price::float8 AS price, r.url, r.seller, r.rating::float8 AS rating,
                ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
         FROM results r
         JOIN scrape_runs sr ON sr.id = r.scrape_run_id
         JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
         WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${afR}
       )
       SELECT scrape_run_id, executed_at, title, price, url, seller, rating
       FROM ranked WHERE rn = 1 ORDER BY executed_at ASC`,
      pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
    ),
    pool.query(
      pq.manual
        ? `WITH
       ${RUNS_ONE_PER_DAY_CTE.trim()}
       SELECT sr.id AS scrape_run_id, sr.executed_at,
              MIN(r.price)::float8 AS min_price,
              MAX(r.price)::float8 AS max_price,
              AVG(r.price)::float8 AS avg_price,
              STDDEV_POP(r.price)::float8 AS stddev_pop,
              COUNT(*)::int AS listing_count
       FROM results r
       JOIN scrape_runs sr ON sr.id = r.scrape_run_id
       JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
       WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${mfR}
       GROUP BY sr.id, sr.executed_at
       ORDER BY sr.executed_at ASC`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
       SELECT sr.id AS scrape_run_id, sr.executed_at,
              MIN(r.price)::float8 AS min_price,
              MAX(r.price)::float8 AS max_price,
              AVG(r.price)::float8 AS avg_price,
              STDDEV_POP(r.price)::float8 AS stddev_pop,
              COUNT(*)::int AS listing_count
       FROM results r
       JOIN scrape_runs sr ON sr.id = r.scrape_run_id
       JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
       WHERE r.search_id = $1 AND r.price IS NOT NULL AND ${afR}
       GROUP BY sr.id, sr.executed_at
       ORDER BY sr.executed_at ASC`,
      pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
    ),
    pool.query(
      pq.manual
        ? `SELECT COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
              COUNT(*)::int AS listing_count,
              AVG(results.rating)::float8 AS avg_rating,
              MIN(results.price)::float8 AS min_price_seen,
              MAX(results.created_at) AS last_seen_at
       FROM results
       WHERE results.search_id = $1 AND results.created_at > NOW() - interval '90 days'
         AND ${mfRes}
       GROUP BY 1
       ORDER BY listing_count DESC
       LIMIT 15`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
       SELECT COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
              COUNT(*)::int AS listing_count,
              AVG(results.rating)::float8 AS avg_rating,
              MIN(results.price)::float8 AS min_price_seen,
              MAX(results.created_at) AS last_seen_at
       FROM results
       WHERE results.search_id = $1 AND results.created_at > NOW() - interval '90 days'
         AND ${afRes}
       GROUP BY 1
       ORDER BY listing_count DESC
       LIMIT 15`,
      pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
    ),
    pool.query(
      pq.manual
        ? `SELECT COUNT(*)::int AS total_results,
              COUNT(*) FILTER (WHERE results.official_store_required IS TRUE)::int AS required_official_count,
              COUNT(*) FILTER (WHERE results.official_store_required IS TRUE AND results.official_store_applied IS TRUE)::int AS official_met_count,
              COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE)::int AS required_free_ship_count,
              COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE AND results.free_shipping_applied IS TRUE)::int AS free_ship_met_count
       FROM results
       WHERE results.search_id = $1 AND ${mfRes}`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
       SELECT COUNT(*)::int AS total_results,
              COUNT(*) FILTER (WHERE results.official_store_required IS TRUE)::int AS required_official_count,
              COUNT(*) FILTER (WHERE results.official_store_required IS TRUE AND results.official_store_applied IS TRUE)::int AS official_met_count,
              COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE)::int AS required_free_ship_count,
              COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE AND results.free_shipping_applied IS TRUE)::int AS free_ship_met_count
       FROM results
       WHERE results.search_id = $1 AND ${afRes}`,
      pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
    ),
    pool.query(
      pq.manual ? REPORT_PEERS_MANUAL : REPORT_PEERS_AUTO,
      pq.manual
        ? [String(article.article), String(article.detail ?? ""), pq.productTitle, pq.sellerOrNull]
        : [String(article.article), String(article.detail ?? "")],
    ),
    pool.query(
      pq.manual
        ? `SELECT trim(both from regexp_replace(lower(trim($1::text)), E'\\\\s+', ' ', 'g')) AS norm_title,
                  $1::text AS display_title`
        : `WITH
       ${CTE_CANONICAL_PRODUCT_TITLE.trim()}
       SELECT norm_title, display_title FROM canonical_norm_title`,
      pq.manual ? [pq.productTitle] : [articleId],
    ),
  ]);

  const series = priceSeries.rows as { min_price: number; executed_at: string }[];
  let runToRunTrendPct: number | null = null;
  if (series.length >= 2) {
    const prev = series[series.length - 2]!.min_price;
    const last = series[series.length - 1]!.min_price;
    if (prev > 0 && Number.isFinite(last)) {
      runToRunTrendPct = (last - prev) / prev;
    }
  }

  const dispRows = dispersion.rows as {
    avg_price: number | null;
    stddev_pop: number | null;
  }[];
  let lastRunCv: number | null = null;
  if (dispRows.length) {
    const last = dispRows[dispRows.length - 1]!;
    const avg = last.avg_price;
    const std = last.stddev_pop;
    if (avg && avg > 0 && std != null && Number.isFinite(std)) {
      lastRunCv = std / avg;
    }
  }

  const peerList = peers.rows as {
    id: number;
    latest_run_min_price: number | null;
  }[];
  const sorted = [...peerList].sort(
    (a, b) => (a.latest_run_min_price ?? Infinity) - (b.latest_run_min_price ?? Infinity),
  );
  const rankIndex = sorted.findIndex((p) => p.id === articleId);
  const peerRankIndex = rankIndex >= 0 ? rankIndex : 0;
  const peerCount = sorted.length;

  const recommendation = buildRecommendation({
    peerRankIndex: peerCount ? peerRankIndex : 0,
    peerCount,
    runToRunTrendPct,
    lastRunCoefficientOfVariation: lastRunCv,
  });

  const disclaimer =
    "Resumen basado en datos scrapeados; no constituye asesoramiento financiero ni garantía de precio.";

  const scope = scopeRow.rows[0] as
    | { norm_title: string; display_title: string | null }
    | undefined;

  res.json({
    generatedAt: new Date().toISOString(),
    article,
    disclaimer,
    analyticsScope: {
      hasCanonicalProduct: Boolean(scope?.norm_title),
      scopeMode: pq.manual ? ("manual" as const) : ("auto" as const),
      canonicalNormTitle: scope?.norm_title ?? null,
      displayTitle: pq.manual ? pq.productTitle : (scope?.display_title ?? null),
      sellerFilter: pq.manual ? pq.sellerOrNull : null,
    },
    sections: {
      priceSeries: priceSeries.rows,
      bestOfferPerRun: bestPerRun.rows,
      dispersionPerRun: dispersion.rows.map((row: Record<string, unknown>) => {
        const avg = row.avg_price as number | null;
        const std = row.stddev_pop as number | null;
        const cv =
          avg && avg > 0 && std != null && Number.isFinite(std) ? std / avg : null;
        return { ...row, coefficient_of_variation: cv };
      }),
      sellers: sellers.rows,
      criteriaCompliance: criteria.rows[0] ?? {},
      peerComparisonByBrand: peers.rows,
    },
    recommendation,
  });
});
