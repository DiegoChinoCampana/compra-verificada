import { pool } from "./db.js";
import { loadHotSaleVotedSlots, type HotSaleVotedSlot } from "./config/hotSaleVoted.js";
import { buildHotSaleNarrative, type HotSaleNarrative } from "./hotSaleNarrative.js";
import {
  sqlNormSeller,
  sqlProductGroupingKey,
  sqlWhereRespectClusterWhenPresent,
} from "./sql/articleSameProductTitle.js";

const ALLOWED_DAYS = new Set([10, 30, 60]);

export type HotSaleTrendRow = {
  article_id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  /** Tienda normalizada usada como ancla (la del listado más barato del primer día con ese clúster). */
  trend_seller: string | null;
  first_min: number;
  last_min: number;
  trend_pct: number;
  n_points: number;
  w_min: number;
  w_max: number;
  w_median: number;
  max_dod_drop_pct: number;
  market_first_min: number;
  market_last_min: number;
  market_trend_pct: number;
  market_n_points: number;
  market_w_min: number;
  market_w_max: number;
  market_w_median: number;
  market_max_dod_drop_pct: number;
  narrative: HotSaleNarrative;
};

export type HotSaleVotedPayloadRow = {
  pollLabel: string;
  instagramLabel: string;
  articleId: number | null;
  /** true si el ID salió de `match` (ILIKE) y no de `articleId` fijo en config. */
  resolvedByMatch: boolean;
  /**
   * true si no hubo ficha con el criterio completo y se usó un nivel más laxo (solo marca, etc.).
   */
  approximateMatch: boolean;
  linked: boolean;
  article: string | null;
  brand: string | null;
  detail: string | null;
  first_min: number | null;
  last_min: number | null;
  trend_pct: number | null;
  n_points: number | null;
  w_min: number | null;
  w_max: number | null;
  w_median: number | null;
  max_dod_drop_pct: number | null;
  trend_seller: string | null;
  market_first_min: number | null;
  market_last_min: number | null;
  market_trend_pct: number | null;
  market_n_points: number | null;
  market_w_min: number | null;
  market_w_max: number | null;
  market_w_median: number | null;
  market_max_dod_drop_pct: number | null;
  narrative: HotSaleNarrative | null;
};

export type HotSaleRoundupPayload = {
  generatedAt: string;
  days: number;
  disclaimer: string;
  voted: HotSaleVotedPayloadRow[];
  topPriceDrops: HotSaleTrendRow[];
};

const TRENDS_SQL = `
WITH params AS (
  SELECT $1::int AS days_window
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
  WHERE r.price IS NOT NULL AND r.price > 0
    AND sr.executed_at >= NOW() - (p.days_window * interval '1 day')
  ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
),
runs_one_per_day_canonical AS (
  SELECT DISTINCT ON (r.search_id, date_trunc('day', sr.executed_at))
    r.search_id,
    sr.id AS scrape_run_id,
    sr.executed_at
  FROM results r
  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
  INNER JOIN articles a ON a.id = r.search_id AND a.enabled = TRUE
  WHERE r.price IS NOT NULL AND r.price > 0
    AND sr.executed_at >= NOW() - interval '365 days'
  ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
),
run_cheapest_key AS (
  SELECT DISTINCT ON (d.search_id, d.scrape_run_id)
    d.search_id,
    d.scrape_run_id,
    d.executed_at,
    ${sqlProductGroupingKey("r")} AS gk
  FROM runs_one_per_day_canonical d
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
daily AS (
  SELECT search_id,
    date_trunc('day', executed_at)::date AS d,
    MIN(min_price)::float8 AS day_min
  FROM run_mins
  GROUP BY search_id, date_trunc('day', executed_at)::date
),
window_stats AS (
  SELECT
    search_id,
    MIN(day_min)::float8 AS w_min,
    MAX(day_min)::float8 AS w_max,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY day_min)::float8 AS w_median
  FROM daily
  GROUP BY search_id
  HAVING COUNT(*) >= 2
),
dod AS (
  SELECT
    search_id,
    day_min,
    LAG(day_min) OVER (PARTITION BY search_id ORDER BY d) AS prev_min
  FROM daily
),
dod_stats AS (
  SELECT search_id,
    COALESCE(MAX(
      CASE
        WHEN prev_min IS NOT NULL AND prev_min > 0 AND day_min < prev_min
        THEN ((prev_min - day_min) / prev_min)::float8
        ELSE NULL
      END
    ), 0)::float8 AS max_dod_drop_pct
  FROM dod
  GROUP BY search_id
),
ordered AS (
  SELECT search_id, min_price, executed_at,
    ROW_NUMBER() OVER (PARTITION BY search_id ORDER BY executed_at ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY search_id ORDER BY executed_at DESC) AS rn_last
  FROM run_mins
),
ends AS (
  SELECT search_id,
    MAX(min_price) FILTER (WHERE rn_first = 1) AS first_min,
    MAX(min_price) FILTER (WHERE rn_last = 1) AS last_min,
    COUNT(*)::int AS n_points
  FROM ordered
  GROUP BY search_id
  HAVING COUNT(*) >= 2
),
trends_anchor AS (
  SELECT
    e.search_id AS article_id,
    e.first_min,
    e.last_min,
    e.n_points,
    CASE WHEN e.first_min > 0 THEN ((e.last_min - e.first_min) / e.first_min)::float8 END AS trend_pct,
    ws.w_min,
    ws.w_max,
    ws.w_median,
    ds.max_dod_drop_pct
  FROM ends e
  INNER JOIN window_stats ws ON ws.search_id = e.search_id
  INNER JOIN dod_stats ds ON ds.search_id = e.search_id
),
daily_market AS (
  SELECT search_id,
    date_trunc('day', executed_at)::date AS d,
    MIN(min_price)::float8 AS day_min
  FROM run_mins_market
  GROUP BY search_id, date_trunc('day', executed_at)::date
),
window_stats_market AS (
  SELECT
    search_id,
    MIN(day_min)::float8 AS w_min,
    MAX(day_min)::float8 AS w_max,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY day_min)::float8 AS w_median
  FROM daily_market
  GROUP BY search_id
  HAVING COUNT(*) >= 2
),
dod_market AS (
  SELECT
    search_id,
    day_min,
    LAG(day_min) OVER (PARTITION BY search_id ORDER BY d) AS prev_min
  FROM daily_market
),
dod_stats_market AS (
  SELECT search_id,
    COALESCE(MAX(
      CASE
        WHEN prev_min IS NOT NULL AND prev_min > 0 AND day_min < prev_min
        THEN ((prev_min - day_min) / prev_min)::float8
        ELSE NULL
      END
    ), 0)::float8 AS max_dod_drop_pct
  FROM dod_market
  GROUP BY search_id
),
ordered_market AS (
  SELECT search_id, min_price, executed_at,
    ROW_NUMBER() OVER (PARTITION BY search_id ORDER BY executed_at ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY search_id ORDER BY executed_at DESC) AS rn_last
  FROM run_mins_market
),
ends_market AS (
  SELECT search_id,
    MAX(min_price) FILTER (WHERE rn_first = 1) AS first_min,
    MAX(min_price) FILTER (WHERE rn_last = 1) AS last_min,
    COUNT(*)::int AS n_points
  FROM ordered_market
  GROUP BY search_id
  HAVING COUNT(*) >= 2
),
trends_market AS (
  SELECT
    e.search_id AS article_id,
    e.first_min,
    e.last_min,
    e.n_points,
    CASE WHEN e.first_min > 0 THEN ((e.last_min - e.first_min) / e.first_min)::float8 END AS trend_pct,
    ws.w_min,
    ws.w_max,
    ws.w_median,
    ds.max_dod_drop_pct
  FROM ends_market e
  INNER JOIN window_stats_market ws ON ws.search_id = e.search_id
  INNER JOIN dod_stats_market ds ON ds.search_id = e.search_id
)
SELECT
  ta.article_id,
  a.article,
  a.brand,
  a.detail,
  an.seller_key::text AS trend_seller,
  ta.first_min::float8,
  ta.last_min::float8,
  ta.trend_pct::float8,
  ta.n_points,
  ta.w_min::float8,
  ta.w_max::float8,
  ta.w_median::float8,
  ta.max_dod_drop_pct::float8,
  tm.first_min::float8 AS market_first_min,
  tm.last_min::float8 AS market_last_min,
  tm.trend_pct::float8 AS market_trend_pct,
  tm.n_points::int AS market_n_points,
  tm.w_min::float8 AS market_w_min,
  tm.w_max::float8 AS market_w_max,
  tm.w_median::float8 AS market_w_median,
  tm.max_dod_drop_pct::float8 AS market_max_dod_drop_pct
FROM trends_anchor ta
INNER JOIN trends_market tm ON tm.article_id = ta.article_id
INNER JOIN articles a ON a.id = ta.article_id AND a.enabled = TRUE
INNER JOIN anchor_seller an ON an.search_id = ta.article_id
`;

function parseDays(raw: unknown): number {
  const n = Number(raw);
  return ALLOWED_DAYS.has(n) ? n : 30;
}

function rowToTrendPayload(r: Record<string, unknown>): HotSaleTrendRow {
  const id = Number(r.article_id);
  const first_min = Number(r.first_min);
  const last_min = Number(r.last_min);
  const trend_pct = Number(r.trend_pct);
  const n_points = Number(r.n_points);
  const w_min = Number(r.w_min);
  const w_max = Number(r.w_max);
  const w_median = Number(r.w_median);
  const max_dod_drop_pct = Number(r.max_dod_drop_pct);
  const market_first_min = Number(r.market_first_min);
  const market_last_min = Number(r.market_last_min);
  const market_trend_pct = Number(r.market_trend_pct);
  const market_n_points = Number(r.market_n_points);
  const market_w_min = Number(r.market_w_min);
  const market_w_max = Number(r.market_w_max);
  const market_w_median = Number(r.market_w_median);
  const market_max_dod_drop_pct = Number(r.market_max_dod_drop_pct);
  const ts = r.trend_seller;
  const trend_seller =
    ts == null || String(ts).trim() === "" ? null : String(ts);
  const narrative = buildHotSaleNarrative({
    first_min,
    last_min,
    w_max,
    w_median,
    max_dod_drop_pct,
    n_points,
    market_first_min:
      Number.isFinite(market_first_min) && market_first_min > 0 ? market_first_min : null,
    market_last_min:
      Number.isFinite(market_last_min) && market_last_min > 0 ? market_last_min : null,
    market_trend_pct: Number.isFinite(market_trend_pct) ? market_trend_pct : null,
  });
  return {
    article_id: id,
    article: String(r.article ?? ""),
    brand: r.brand == null ? null : String(r.brand),
    detail: r.detail == null ? null : String(r.detail),
    trend_seller,
    first_min,
    last_min,
    trend_pct,
    n_points,
    w_min,
    w_max,
    w_median,
    max_dod_drop_pct,
    market_first_min,
    market_last_min,
    market_trend_pct,
    market_n_points,
    market_w_min,
    market_w_max,
    market_w_median,
    market_max_dod_drop_pct,
    narrative,
  };
}

function mapTrendRows(rows: Record<string, unknown>[]): Map<number, HotSaleTrendRow> {
  const m = new Map<number, HotSaleTrendRow>();
  for (const r of rows) {
    const id = Number(r.article_id);
    if (!Number.isInteger(id)) continue;
    m.set(id, rowToTrendPayload(r));
  }
  return m;
}

type EnrichedVotedSlot = {
  slot: HotSaleVotedSlot;
  effectiveArticleId: number | null;
  resolvedByMatch: boolean;
  approximateMatch: boolean;
};

/** Fragmentos por intento: de más específico a más laxo (ej. solo marca «Adidas»). */
function hotSaleMatchAttempts(m: NonNullable<HotSaleVotedSlot["match"]>): { article: string; brand: string; detail: string }[] {
  const article = (m.article ?? "").trim();
  const brand = (m.brand ?? "").trim();
  const detail = (m.detail ?? "").trim();
  const attempts: { article: string; brand: string; detail: string }[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, d: string) => {
    if (!a && !b && !d) return;
    const key = `${a}\x1d${b}\x1d${d}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ article: a, brand: b, detail: d });
  };
  add(article, brand, detail);
  if (detail) add(article, brand, "");
  if (article) add("", brand, detail);
  if (brand) add("", brand, "");
  if (article) add(article, "", "");
  if (detail) add("", "", detail);
  return attempts;
}

async function resolveArticleIdByMatch(
  m: NonNullable<HotSaleVotedSlot["match"]>,
): Promise<{ id: number | null; approximateMatch: boolean }> {
  const attempts = hotSaleMatchAttempts(m);
  if (attempts.length === 0) return { id: null, approximateMatch: false };
  for (let i = 0; i < attempts.length; i++) {
    const { article, brand, detail } = attempts[i];
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM articles
       WHERE enabled = TRUE
         AND ($1::text = '' OR article ILIKE '%' || $1 || '%')
         AND ($2::text = '' OR COALESCE(brand, '') ILIKE '%' || $2 || '%')
         AND ($3::text = '' OR COALESCE(detail, '') ILIKE '%' || $3 || '%')
       ORDER BY id DESC
       LIMIT 1`,
      [article, brand, detail],
    );
    const id = Number(rows[0]?.id);
    if (Number.isInteger(id)) return { id, approximateMatch: i > 0 };
  }
  return { id: null, approximateMatch: false };
}

async function enrichVotedSlots(slots: HotSaleVotedSlot[]): Promise<EnrichedVotedSlot[]> {
  const out: EnrichedVotedSlot[] = [];
  for (const slot of slots) {
    if (slot.articleId != null && Number.isInteger(slot.articleId) && slot.articleId > 0) {
      out.push({
        slot,
        effectiveArticleId: slot.articleId,
        resolvedByMatch: false,
        approximateMatch: false,
      });
      continue;
    }
    let id: number | null = null;
    let approximateMatch = false;
    if (slot.match) {
      const r = await resolveArticleIdByMatch(slot.match);
      id = r.id;
      approximateMatch = Boolean(r.approximateMatch && id != null);
    }
    out.push({ slot, effectiveArticleId: id, resolvedByMatch: id != null, approximateMatch });
  }
  return out;
}

function buildVotedRows(
  enriched: EnrichedVotedSlot[],
  trendByArticle: Map<number, HotSaleTrendRow>,
  articlesMeta: Map<number, { article: string; brand: string | null; detail: string | null }>,
): HotSaleVotedPayloadRow[] {
  return enriched.map((e) => {
    const aid = e.effectiveArticleId;
    const resolvedByMatch = e.resolvedByMatch;
    const approximateMatch = e.approximateMatch;

    if (aid == null || !Number.isInteger(aid)) {
      return {
        pollLabel: e.slot.pollLabel,
        instagramLabel: e.slot.instagramLabel,
        articleId: null,
        resolvedByMatch: false,
        approximateMatch: false,
        linked: false,
        article: null,
        brand: null,
        detail: null,
        first_min: null,
        last_min: null,
        trend_pct: null,
        n_points: null,
        w_min: null,
        w_max: null,
        w_median: null,
        max_dod_drop_pct: null,
        trend_seller: null,
        market_first_min: null,
        market_last_min: null,
        market_trend_pct: null,
        market_n_points: null,
        market_w_min: null,
        market_w_max: null,
        market_w_median: null,
        market_max_dod_drop_pct: null,
        narrative: null,
      };
    }
    const t = trendByArticle.get(aid);
    const meta = articlesMeta.get(aid);
    if (!t) {
      return {
        pollLabel: e.slot.pollLabel,
        instagramLabel: e.slot.instagramLabel,
        articleId: aid,
        resolvedByMatch,
        approximateMatch,
        linked: Boolean(meta),
        article: meta?.article ?? null,
        brand: meta?.brand ?? null,
        detail: meta?.detail ?? null,
        first_min: null,
        last_min: null,
        trend_pct: null,
        n_points: null,
        w_min: null,
        w_max: null,
        w_median: null,
        max_dod_drop_pct: null,
        trend_seller: null,
        market_first_min: null,
        market_last_min: null,
        market_trend_pct: null,
        market_n_points: null,
        market_w_min: null,
        market_w_max: null,
        market_w_median: null,
        market_max_dod_drop_pct: null,
        narrative: null,
      };
    }
    return {
      pollLabel: e.slot.pollLabel,
      instagramLabel: e.slot.instagramLabel,
      articleId: aid,
      resolvedByMatch,
      approximateMatch,
      linked: true,
      article: t.article,
      brand: t.brand,
      detail: t.detail,
      first_min: t.first_min,
      last_min: t.last_min,
      trend_pct: t.trend_pct,
      n_points: t.n_points,
      w_min: t.w_min,
      w_max: t.w_max,
      w_median: t.w_median,
      max_dod_drop_pct: t.max_dod_drop_pct,
      trend_seller: t.trend_seller,
      market_first_min: t.market_first_min,
      market_last_min: t.market_last_min,
      market_trend_pct: t.market_trend_pct,
      market_n_points: t.market_n_points,
      market_w_min: t.market_w_min,
      market_w_max: t.market_w_max,
      market_w_median: t.market_w_median,
      market_max_dod_drop_pct: t.market_max_dod_drop_pct,
      narrative: t.narrative,
    };
  });
}

/** Fichas habilitadas con caída de precio (primer vs último relevamiento en ventana), excluyendo votadas. */
function pickTopDrops(
  allRows: HotSaleTrendRow[],
  votedIds: Set<number>,
  limit: number,
): HotSaleTrendRow[] {
  return allRows
    .filter((r) => !votedIds.has(r.article_id) && r.trend_pct < 0)
    .sort((a, b) => a.trend_pct - b.trend_pct)
    .slice(0, limit);
}

async function fetchArticlesMeta(ids: number[]): Promise<Map<number, { article: string; brand: string | null; detail: string | null }>> {
  const m = new Map<number, { article: string; brand: string | null; detail: string | null }>();
  if (ids.length === 0) return m;
  const { rows } = await pool.query(
    `SELECT id, article, brand, detail FROM articles WHERE id = ANY($1::int[])`,
    [ids],
  );
  for (const r of rows as Record<string, unknown>[]) {
    const id = Number(r.id);
    if (!Number.isInteger(id)) continue;
    m.set(id, {
      article: String(r.article ?? ""),
      brand: r.brand == null ? null : String(r.brand),
      detail: r.detail == null ? null : String(r.detail),
    });
  }
  return m;
}

export async function buildHotSaleRoundup(queryDays: unknown): Promise<HotSaleRoundupPayload> {
  const days = parseDays(queryDays);
  const { rows } = await pool.query(TRENDS_SQL, [days]);
  const trendRows = rows as Record<string, unknown>[];
  const trendByArticle = mapTrendRows(trendRows);

  const votedSlots = await loadHotSaleVotedSlots();
  const enriched = await enrichVotedSlots(votedSlots);

  const votedIds = new Set(
    enriched
      .map((e) => e.effectiveArticleId)
      .filter((id): id is number => id != null && Number.isInteger(id)),
  );

  const linkedIds = enriched
    .map((e) => e.effectiveArticleId)
    .filter((id): id is number => id != null && Number.isInteger(id));

  const articlesMeta = await fetchArticlesMeta(linkedIds);

  const voted = buildVotedRows(enriched, trendByArticle, articlesMeta);
  const allTrend = [...trendByArticle.values()];
  const topPriceDrops = pickTopDrops(allTrend, votedIds, 10);

  return {
    generatedAt: new Date().toISOString(),
    days,
    disclaimer:
      "Información orientativa según publicaciones relevadas; los precios pueden cambiar. No es asesoramiento financiero.",
    voted,
    topPriceDrops,
  };
}
