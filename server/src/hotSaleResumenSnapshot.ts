import { pool } from "./db.js";
import {
  sqlNormSeller,
  sqlProductGroupingKey,
  sqlWhereRespectClusterWhenPresent,
} from "./sql/articleSameProductTitle.js";

const ALLOWED_DAYS = new Set([10, 30, 60]);

export type HotSaleResumenSnapshot = {
  days: number;
  lastRunAt: string;
  lastRunMinAny: number;
  lastRunCheapestSeller: string | null;
  anchorSeller: string | null;
  anchorFirstMin: number;
  anchorMaxInWindow: number;
  /** Listado más barato en la última corrida: otra tienda que la ancla y por debajo del mínimo inicial de la ancla. */
  otherStoreBeatAnchor: boolean;
};

/** Misma lógica de ventana / clúster / ancla que la guía Hot Sale, para una sola ficha. */
const SNAPSHOT_SQL = `
WITH params AS (
  SELECT $2::int AS days_window
),
runs_one_per_day AS (
  SELECT DISTINCT ON (r.search_id, date_trunc('day', sr.executed_at))
    r.search_id,
    sr.id AS scrape_run_id,
    sr.executed_at
  FROM results r
  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
  CROSS JOIN params p
  INNER JOIN articles a ON a.id = r.search_id AND a.enabled = TRUE
  WHERE r.search_id = $1
    AND r.price IS NOT NULL AND r.price > 0
    AND sr.executed_at >= NOW() - (p.days_window * interval '1 day')
  ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
),
run_cheapest_key AS (
  SELECT DISTINCT ON (d.search_id, d.scrape_run_id)
    d.search_id,
    d.scrape_run_id,
    d.executed_at,
    ${sqlProductGroupingKey("r")} AS gk
  FROM runs_one_per_day d
  INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
  WHERE r.price IS NOT NULL AND r.price > 0
    AND ${sqlWhereRespectClusterWhenPresent("r")}
    AND length(trim(${sqlProductGroupingKey("r")})) > 0
  ORDER BY d.search_id, d.scrape_run_id, r.price ASC NULLS LAST, r.id ASC
),
canonical_per_article AS (
  SELECT search_id, canonical_gk
  FROM (
    SELECT search_id, gk AS canonical_gk,
      ROW_NUMBER() OVER (
        PARTITION BY search_id
        ORDER BY win_cnt DESC, win_last DESC
      ) AS rn
    FROM (
      SELECT search_id, gk, COUNT(*)::int AS win_cnt, MAX(executed_at) AS win_last
      FROM run_cheapest_key
      GROUP BY search_id, gk
    ) tallies
  ) z
  WHERE rn = 1
),
first_run_for_article AS (
  SELECT DISTINCT ON (d.search_id)
    d.search_id,
    d.scrape_run_id,
    d.executed_at
  FROM runs_one_per_day d
  INNER JOIN canonical_per_article ck ON ck.search_id = d.search_id
  INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
  WHERE r.price IS NOT NULL AND r.price > 0
    AND ${sqlWhereRespectClusterWhenPresent("r")}
    AND ${sqlProductGroupingKey("r")} = ck.canonical_gk
    AND length(trim(${sqlProductGroupingKey("r")})) > 0
  ORDER BY d.search_id, d.executed_at ASC
),
anchor_seller AS (
  SELECT DISTINCT ON (fr.search_id)
    fr.search_id,
    ${sqlNormSeller("r")} AS seller_key
  FROM first_run_for_article fr
  INNER JOIN canonical_per_article ck ON ck.search_id = fr.search_id
  INNER JOIN results r ON r.search_id = fr.search_id AND r.scrape_run_id = fr.scrape_run_id
  WHERE r.price IS NOT NULL AND r.price > 0
    AND ${sqlWhereRespectClusterWhenPresent("r")}
    AND ${sqlProductGroupingKey("r")} = ck.canonical_gk
  ORDER BY fr.search_id, r.price ASC NULLS LAST, r.id ASC
),
run_mins AS (
  SELECT d.search_id, d.scrape_run_id, d.executed_at, MIN(r.price)::float8 AS min_price
  FROM runs_one_per_day d
  INNER JOIN canonical_per_article ck ON ck.search_id = d.search_id
  INNER JOIN anchor_seller an ON an.search_id = d.search_id
  INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
  WHERE r.price IS NOT NULL AND r.price > 0
    AND ${sqlWhereRespectClusterWhenPresent("r")}
    AND ${sqlProductGroupingKey("r")} = ck.canonical_gk
    AND ${sqlNormSeller("r")} = an.seller_key
  GROUP BY d.search_id, d.scrape_run_id, d.executed_at
),
run_mins_market AS (
  SELECT d.search_id, d.scrape_run_id, d.executed_at, MIN(r.price)::float8 AS min_price
  FROM runs_one_per_day d
  INNER JOIN canonical_per_article ck ON ck.search_id = d.search_id
  INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
  WHERE r.price IS NOT NULL AND r.price > 0
    AND ${sqlWhereRespectClusterWhenPresent("r")}
    AND ${sqlProductGroupingKey("r")} = ck.canonical_gk
  GROUP BY d.search_id, d.scrape_run_id, d.executed_at
),
last_market AS (
  SELECT search_id, scrape_run_id, executed_at, min_price
  FROM run_mins_market
  WHERE search_id = $1
  ORDER BY executed_at DESC
  LIMIT 1
),
first_anchor AS (
  SELECT search_id, scrape_run_id, executed_at, min_price
  FROM run_mins
  WHERE search_id = $1
  ORDER BY executed_at ASC
  LIMIT 1
),
anchor_daily AS (
  SELECT date_trunc('day', executed_at)::date AS d, MIN(min_price)::float8 AS day_min
  FROM run_mins
  WHERE search_id = $1
  GROUP BY 1
),
anchor_w_max AS (
  SELECT MAX(day_min)::float8 AS w_max
  FROM anchor_daily
)
SELECT
  lm.executed_at AS last_run_at,
  lm.min_price::float8 AS last_run_min_any,
  (
    SELECT (${sqlNormSeller("r")})::text
    FROM results r
    INNER JOIN last_market lm2 ON lm2.scrape_run_id = r.scrape_run_id AND lm2.search_id = r.search_id
    INNER JOIN canonical_per_article ck ON ck.search_id = r.search_id
    WHERE r.search_id = $1
      AND r.price IS NOT NULL AND r.price > 0
      AND ${sqlWhereRespectClusterWhenPresent("r")}
      AND ${sqlProductGroupingKey("r")} = ck.canonical_gk
      AND r.price = lm2.min_price
    ORDER BY r.id ASC
    LIMIT 1
  ) AS last_run_cheapest_seller,
  fa.min_price::float8 AS anchor_first_min,
  COALESCE(aw.w_max, 0)::float8 AS anchor_max_in_window,
  an.seller_key::text AS anchor_seller
FROM last_market lm
INNER JOIN first_anchor fa ON fa.search_id = lm.search_id
CROSS JOIN anchor_w_max aw
INNER JOIN anchor_seller an ON an.search_id = lm.search_id
`;

export async function fetchHotSaleResumenSnapshot(
  articleId: number,
  daysRaw: unknown,
): Promise<HotSaleResumenSnapshot | null> {
  const n = Number(daysRaw);
  if (!ALLOWED_DAYS.has(n) || !Number.isInteger(articleId) || articleId <= 0) return null;
  const days = n as 10 | 30 | 60;

  const { rows } = await pool.query(SNAPSHOT_SQL, [articleId, days]);
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  const lastRunMinAny = Number(r.last_run_min_any);
  const anchorFirstMin = Number(r.anchor_first_min);
  const anchorMaxInWindow = Number(r.anchor_max_in_window);
  const lastAt = r.last_run_at;
  if (
    !Number.isFinite(lastRunMinAny) ||
    lastRunMinAny <= 0 ||
    !Number.isFinite(anchorFirstMin) ||
    anchorFirstMin <= 0 ||
    !Number.isFinite(anchorMaxInWindow) ||
    lastAt == null
  ) {
    return null;
  }

  const lrcs = r.last_run_cheapest_seller;
  const lastRunCheapestSeller =
    lrcs == null || String(lrcs).trim() === "" ? null : String(lrcs);
  const ans = r.anchor_seller;
  const anchorSeller = ans == null || String(ans).trim() === "" ? null : String(ans);

  const eps = Math.max(0.01, anchorFirstMin * 0.002);
  const loweredEnough = lastRunMinAny < anchorFirstMin - eps;
  const otherStore =
    anchorSeller != null &&
    lastRunCheapestSeller != null &&
    lastRunCheapestSeller !== anchorSeller;
  const otherStoreBeatAnchor = loweredEnough && otherStore;

  return {
    days,
    lastRunAt: new Date(lastAt as string).toISOString(),
    lastRunMinAny,
    lastRunCheapestSeller,
    anchorSeller,
    anchorFirstMin,
    anchorMaxInWindow,
    otherStoreBeatAnchor,
  };
}
