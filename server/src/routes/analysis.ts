import { Router } from "express";
import { pool } from "../db.js";
import { sqlNormTitle } from "../sql/articleSameProductTitle.js";

export const analysisRouter = Router();

const ALLOWED_DAYS = new Set([10, 30, 60]);

const normTitleExpr = sqlNormTitle("r");

/**
 * Por nombre de artículo (fichas habilitadas que lo contienen en `articles.article`):
 * agrupa **todos los resultados scrapeados** por título de publicación normalizado (mismo criterio
 * que tablero / informe con `productTitle`: lower, espacios colapsados).
 * Por cada título único: mínimo precio por día (una corrida por día y ficha, la más reciente),
 * métricas de estabilidad y enlace vía `primary_article_id` + título display.
 */
analysisRouter.get("/price-stability-by-name", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const daysRaw = Number(req.query.days);
  const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : 30;

  if (name.length < 2) {
    res.status(400).json({ error: "Query param name is required (min 2 characters)" });
    return;
  }

  const sql = `
    WITH params AS (
      SELECT $1::text AS raw_name, $2::int AS days_window
    ),
    candidates AS (
      SELECT a.id
      FROM articles a
      WHERE a.enabled = TRUE
        AND a.article ILIKE '%' || trim($1::text) || '%'
      LIMIT 250
    ),
    runs_per_day AS (
      SELECT DISTINCT ON (r.search_id, date_trunc('day', sr.executed_at))
        r.search_id,
        date_trunc('day', sr.executed_at)::date AS d,
        sr.id AS scrape_run_id,
        sr.executed_at
      FROM results r
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      INNER JOIN candidates c ON c.id = r.search_id
      CROSS JOIN params p
      WHERE sr.executed_at >= NOW() - (p.days_window * interval '1 day')
        AND r.price IS NOT NULL AND r.price > 0
      ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
    ),
    result_rows AS (
      SELECT
        ${normTitleExpr} AS title_key,
        r.title AS title_raw,
        r.search_id,
        r.price::float8 AS price,
        sr.executed_at
      FROM runs_per_day x
      INNER JOIN results r ON r.search_id = x.search_id AND r.scrape_run_id = x.scrape_run_id
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      WHERE r.price > 0
        AND length(trim(coalesce(r.title, ''))) > 0
        AND date_trunc('day', sr.executed_at)::date = x.d
    ),
    daily AS (
      SELECT
        title_key,
        date_trunc('day', executed_at)::date AS d,
        MIN(price)::float8 AS day_min
      FROM result_rows
      GROUP BY title_key, date_trunc('day', executed_at)::date
    ),
    stats AS (
      SELECT
        title_key,
        COUNT(*)::int AS n_days,
        MIN(day_min)::float8 AS min_daily_in_period,
        MAX(day_min)::float8 AS max_daily_in_period,
        AVG(day_min)::float8 AS avg_daily_min,
        STDDEV_POP(day_min)::float8 AS stddev_daily_min,
        (array_agg(day_min ORDER BY d ASC))[1]::float8 AS first_day_min,
        (array_agg(day_min ORDER BY d DESC))[1]::float8 AS last_day_min
      FROM daily
      GROUP BY title_key
      HAVING COUNT(*) >= 2
    ),
    product_title AS (
      SELECT
        title_key,
        (array_agg(title_raw ORDER BY executed_at DESC, search_id))[1]::text AS product_title
      FROM result_rows
      GROUP BY title_key
    ),
    title_meta AS (
      SELECT
        rr.title_key,
        COUNT(DISTINCT rr.search_id)::int AS n_articles,
        MIN(rr.search_id)::int AS primary_article_id
      FROM result_rows rr
      INNER JOIN stats s ON s.title_key = rr.title_key
      GROUP BY rr.title_key
    ),
    ranked AS (
      SELECT
        pt.product_title,
        tm.n_articles,
        tm.primary_article_id,
        s.title_key,
        s.n_days,
        s.first_day_min,
        s.last_day_min,
        CASE
          WHEN s.first_day_min > 0
          THEN ((s.last_day_min - s.first_day_min) / s.first_day_min)::float8
          ELSE NULL
        END AS trend_pct,
        CASE
          WHEN s.avg_daily_min > 0
          THEN ((s.max_daily_in_period - s.min_daily_in_period) / s.avg_daily_min)::float8
          ELSE NULL
        END AS range_pct,
        CASE
          WHEN s.avg_daily_min > 0 AND s.stddev_daily_min IS NOT NULL
          THEN (s.stddev_daily_min / s.avg_daily_min)::float8
          ELSE NULL
        END AS cv_daily_mins
      FROM stats s
      INNER JOIN title_meta tm ON tm.title_key = s.title_key
      INNER JOIN product_title pt ON pt.title_key = s.title_key
    ),
    numbered AS (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN rnk.trend_pct IS NULL THEN 1 ELSE 0 END,
            ABS(rnk.trend_pct) ASC,
            rnk.trend_pct ASC,
            COALESCE(rnk.range_pct, 999)::float8 ASC,
            rnk.product_title ASC
        )::int AS series_id,
        rnk.product_title,
        rnk.n_articles,
        rnk.primary_article_id,
        rnk.title_key,
        rnk.n_days,
        rnk.first_day_min,
        rnk.last_day_min,
        rnk.trend_pct,
        rnk.range_pct,
        rnk.cv_daily_mins
      FROM ranked rnk
    )
    SELECT
      series_id,
      product_title,
      n_articles,
      primary_article_id,
      n_days,
      first_day_min,
      last_day_min,
      trend_pct,
      range_pct,
      cv_daily_mins,
      title_key
    FROM numbered
    LIMIT 120
  `;

  const { rows: rawRows } = await pool.query<{
    series_id: number;
    product_title: string;
    n_articles: number;
    primary_article_id: number;
    n_days: number;
    first_day_min: string | number;
    last_day_min: string | number;
    trend_pct: string | number | null;
    range_pct: string | number | null;
    cv_daily_mins: string | number | null;
    title_key: string;
  }>(sql, [name, days]);

  const titleKeys = rawRows.map((r) => r.title_key);

  let daily_by_series: {
    series_id: number;
    product_title: string;
    points: { day: string; min_price: number }[];
  }[] = [];

  if (titleKeys.length > 0) {
    const dailySql = `
      WITH params AS (
        SELECT $1::text AS raw_name, $2::int AS days_window
      ),
      candidates AS (
        SELECT a.id
        FROM articles a
        WHERE a.enabled = TRUE
          AND a.article ILIKE '%' || trim($1::text) || '%'
        LIMIT 250
      ),
      runs_per_day AS (
        SELECT DISTINCT ON (r.search_id, date_trunc('day', sr.executed_at))
          r.search_id,
          date_trunc('day', sr.executed_at)::date AS d,
          sr.id AS scrape_run_id,
          sr.executed_at
        FROM results r
        INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
        INNER JOIN candidates c ON c.id = r.search_id
        CROSS JOIN params p
        WHERE sr.executed_at >= NOW() - (p.days_window * interval '1 day')
          AND r.price IS NOT NULL AND r.price > 0
        ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
      ),
      result_rows AS (
        SELECT
          ${normTitleExpr} AS title_key,
          r.title AS title_raw,
          r.search_id,
          r.price::float8 AS price,
          sr.executed_at
        FROM runs_per_day x
        INNER JOIN results r ON r.search_id = x.search_id AND r.scrape_run_id = x.scrape_run_id
        INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
        WHERE r.price > 0
          AND length(trim(coalesce(r.title, ''))) > 0
          AND date_trunc('day', sr.executed_at)::date = x.d
      ),
      daily AS (
        SELECT
          title_key,
          date_trunc('day', executed_at)::date AS d,
          MIN(price)::float8 AS day_min
        FROM result_rows
        GROUP BY title_key, date_trunc('day', executed_at)::date
      )
      SELECT title_key, to_char(d, 'YYYY-MM-DD') AS day, day_min AS min_price
      FROM daily
      WHERE title_key = ANY($3::text[])
      ORDER BY title_key, d
    `;

    const { rows: dailyRows } = await pool.query<{
      title_key: string;
      day: string;
      min_price: string | number;
    }>(dailySql, [name, days, titleKeys]);

    const byKey = new Map<string, { day: string; min_price: number }[]>();
    for (const row of dailyRows) {
      const price = typeof row.min_price === "string" ? parseFloat(row.min_price) : row.min_price;
      if (!byKey.has(row.title_key)) byKey.set(row.title_key, []);
      byKey.get(row.title_key)!.push({ day: row.day, min_price: price });
    }

    daily_by_series = rawRows.map((r) => ({
      series_id: r.series_id,
      product_title: r.product_title,
      points: byKey.get(r.title_key) ?? [],
    }));
  }

  const rows = rawRows.map(({ title_key: _tk, ...rest }) => rest);

  res.json({
    name,
    days,
    count: rows.length,
    rows,
    daily_by_series,
  });
});

/**
 * Brecha vs peers: mismas fichas candidatas que por nombre; por cada una, precio de referencia de la
 * última corrida (mínimo en esa corrida) vs mediana de ese mismo mínimo en otras marcas con mismo
 * texto de artículo + detalle (grupo peer).
 */
analysisRouter.get("/peer-gap-by-name", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (name.length < 2) {
    res.status(400).json({ error: "Query param name is required (min 2 characters)" });
    return;
  }

  const sql = `
    WITH candidates AS (
      SELECT a.id, a.article, a.brand, a.detail
      FROM articles a
      WHERE a.enabled = TRUE
        AND a.article ILIKE '%' || trim($1::text) || '%'
      LIMIT 120
    ),
    peer_pool AS (
      SELECT DISTINCT a.id, a.article, a.brand, a.detail
      FROM articles a
      INNER JOIN candidates c ON
        lower(trim(a.article)) = lower(trim(c.article))
        AND lower(trim(coalesce(a.detail, ''))) = lower(trim(coalesce(c.detail, '')))
      WHERE a.enabled = TRUE
    ),
    latest_run AS (
      SELECT DISTINCT ON (r.search_id)
        r.search_id AS article_id,
        sr.id AS run_id
      FROM results r
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      INNER JOIN peer_pool p ON p.id = r.search_id
      WHERE r.price IS NOT NULL AND r.price > 0
      ORDER BY r.search_id, sr.executed_at DESC
    ),
    latest_run_price AS (
      SELECT lr.article_id, MIN(r.price)::float8 AS ref_min
      FROM latest_run lr
      INNER JOIN results r ON r.scrape_run_id = lr.run_id AND r.search_id = lr.article_id
      WHERE r.price IS NOT NULL AND r.price > 0
      GROUP BY lr.article_id
    ),
    ranked AS (
      SELECT
        c.id,
        c.article,
        c.brand,
        c.detail,
        my.ref_min AS my_ref_min,
        (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.ref_min)
          FROM latest_run_price x
          INNER JOIN articles a ON a.id = x.article_id
          WHERE a.enabled = TRUE
            AND lower(trim(a.article)) = lower(trim(c.article))
            AND lower(trim(coalesce(a.detail, ''))) = lower(trim(coalesce(c.detail, '')))
            AND a.id <> c.id
            AND x.ref_min IS NOT NULL
        )::float8 AS peer_median
      FROM candidates c
      INNER JOIN latest_run_price my ON my.article_id = c.id
    )
    SELECT
      id,
      article,
      brand,
      detail,
      my_ref_min,
      peer_median,
      CASE
        WHEN peer_median IS NOT NULL AND peer_median > 0 AND my_ref_min IS NOT NULL
        THEN ((my_ref_min - peer_median) / peer_median)::float8
        ELSE NULL
      END AS gap_vs_peer_median_pct
    FROM ranked
    ORDER BY
      CASE WHEN peer_median IS NULL THEN 1 ELSE 0 END,
      ABS(
        CASE
          WHEN peer_median IS NOT NULL AND peer_median > 0 AND my_ref_min IS NOT NULL
          THEN (my_ref_min - peer_median) / peer_median
          ELSE 0
        END
      ) DESC NULLS LAST,
      id ASC
    LIMIT 150
  `;

  const { rows } = await pool.query(sql, [name]);
  res.json({
    name,
    count: rows.length,
    rows,
  });
});

/**
 * Saltos de precio entre días consecutivos con dato (mismo criterio de título normalizado y corrida
 * por día que estabilidad). Solo filas cuyo mayor salto relativo día a día >= umbral.
 */
analysisRouter.get("/price-jumps-by-name", async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const daysRaw = Number(req.query.days);
  const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : 30;
  const thrPct = Math.min(100, Math.max(1, Number(req.query.threshold_pct) || 15));
  const thr = thrPct / 100;

  if (name.length < 2) {
    res.status(400).json({ error: "Query param name is required (min 2 characters)" });
    return;
  }

  const sql = `
    WITH params AS (
      SELECT trim($1::text) AS raw_name, $2::int AS days_window, $3::float8 AS thr
    ),
    candidates AS (
      SELECT a.id
      FROM articles a
      WHERE a.enabled = TRUE
        AND a.article ILIKE '%' || trim($1::text) || '%'
      LIMIT 250
    ),
    runs_per_day AS (
      SELECT DISTINCT ON (r.search_id, date_trunc('day', sr.executed_at))
        r.search_id,
        date_trunc('day', sr.executed_at)::date AS d,
        sr.id AS scrape_run_id,
        sr.executed_at
      FROM results r
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      INNER JOIN candidates c ON c.id = r.search_id
      CROSS JOIN params p
      WHERE sr.executed_at >= NOW() - (p.days_window * interval '1 day')
        AND r.price IS NOT NULL AND r.price > 0
      ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
    ),
    result_rows AS (
      SELECT
        ${normTitleExpr} AS title_key,
        r.title AS title_raw,
        r.search_id,
        r.price::float8 AS price,
        sr.executed_at
      FROM runs_per_day x
      INNER JOIN results r ON r.search_id = x.search_id AND r.scrape_run_id = x.scrape_run_id
      INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
      WHERE r.price > 0
        AND length(trim(coalesce(r.title, ''))) > 0
        AND date_trunc('day', sr.executed_at)::date = x.d
    ),
    daily AS (
      SELECT
        title_key,
        date_trunc('day', executed_at)::date AS d,
        MIN(price)::float8 AS day_min
      FROM result_rows
      GROUP BY title_key, date_trunc('day', executed_at)::date
    ),
    ordered AS (
      SELECT
        title_key,
        d,
        day_min,
        LAG(day_min) OVER (PARTITION BY title_key ORDER BY d) AS prev_min,
        LAG(d) OVER (PARTITION BY title_key ORDER BY d) AS prev_d
      FROM daily
    ),
    jump_row AS (
      SELECT
        title_key,
        d AS day_end,
        prev_d AS day_start,
        CASE
          WHEN prev_min IS NOT NULL AND prev_min > 0
          THEN (ABS(day_min - prev_min) / prev_min)::float8
          ELSE NULL
        END AS jump_pct
      FROM ordered
      WHERE prev_min IS NOT NULL
    ),
    by_title AS (
      SELECT title_key, MAX(jump_pct)::float8 AS max_jump_pct
      FROM jump_row
      GROUP BY title_key
      HAVING MAX(jump_pct) >= (SELECT thr FROM params)
    ),
    worst_pair AS (
      SELECT DISTINCT ON (jr.title_key)
        jr.title_key,
        jr.day_start,
        jr.day_end,
        jr.jump_pct AS worst_jump_pct
      FROM jump_row jr
      INNER JOIN by_title b ON b.title_key = jr.title_key
      ORDER BY jr.title_key, jr.jump_pct DESC NULLS LAST, jr.day_end DESC
    ),
    product_pick AS (
      SELECT title_key, (array_agg(title_raw ORDER BY executed_at DESC, search_id))[1]::text AS product_title
      FROM result_rows
      GROUP BY title_key
    ),
    title_meta AS (
      SELECT rr.title_key, COUNT(DISTINCT rr.search_id)::int AS n_articles, MIN(rr.search_id)::int AS primary_article_id
      FROM result_rows rr
      GROUP BY rr.title_key
    )
    SELECT
      pp.product_title,
      tm.n_articles,
      tm.primary_article_id,
      to_char(wp.day_start, 'YYYY-MM-DD') AS day_from,
      to_char(wp.day_end, 'YYYY-MM-DD') AS day_to,
      wp.worst_jump_pct AS max_jump_pct
    FROM by_title b
    INNER JOIN worst_pair wp ON wp.title_key = b.title_key
    INNER JOIN product_pick pp ON pp.title_key = b.title_key
    INNER JOIN title_meta tm ON tm.title_key = b.title_key
    ORDER BY b.max_jump_pct DESC, pp.product_title ASC
    LIMIT 120
  `;

  const { rows } = await pool.query(sql, [name, days, thr]);
  res.json({
    name,
    days,
    threshold_pct: thrPct,
    count: rows.length,
    rows,
  });
});
