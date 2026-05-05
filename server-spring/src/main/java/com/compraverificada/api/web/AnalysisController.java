package com.compraverificada.api.web;

import com.compraverificada.api.sql.SqlSnippets;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/analysis")
public class AnalysisController {

    private static final Set<Integer> ALLOWED_DAYS = Set.of(10, 30, 60);
    private final NamedParameterJdbcTemplate jdbc;

    public AnalysisController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static String gk() { return SqlSnippets.productGroupingKey("r"); }

    /**
     * Estabilidad por nombre: agrupa por product_key (clustering) o por título normalizado.
     * Devuelve métricas por serie + serie diaria (mín. precio por día).
     */
    @GetMapping("/price-stability-by-name")
    public ResponseEntity<?> priceStabilityByName(
            @RequestParam(value = "name", required = false, defaultValue = "") String nameRaw,
            @RequestParam(value = "days", required = false) Integer daysRaw) {

        String name = nameRaw == null ? "" : nameRaw.trim();
        int days = (daysRaw != null && ALLOWED_DAYS.contains(daysRaw)) ? daysRaw : 30;
        if (name.length() < 2) {
            return ResponseEntity.status(400).body(
                    Map.of("error", "Query param name is required (min 2 characters)"));
        }

        String mainSql = ("""
            WITH params AS (
              SELECT CAST(:name AS text) AS raw_name, CAST(:days AS int) AS days_window
            ),
            candidates AS (
              SELECT a.id
              FROM articles a
              WHERE a.enabled = TRUE
                AND a.article ILIKE '%' || trim(CAST(:name AS text)) || '%'
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
                /*GK*/ AS title_key,
                r.title AS title_raw,
                r.product_key AS result_product_key,
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
                CASE
                  WHEN trim(max(coalesce(rr.result_product_key, ''))) <> ''
                  THEN trim(max(rr.result_product_key))
                  ELSE (array_agg(rr.title_raw ORDER BY rr.executed_at DESC, rr.search_id))[1]::text
                END AS product_title,
                (array_agg(rr.title_raw ORDER BY rr.executed_at DESC, rr.search_id))[1]::text AS sample_listing_title
              FROM result_rows rr
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
                pt.sample_listing_title,
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
                rnk.sample_listing_title,
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
              sample_listing_title,
              n_articles,
              primary_article_id,
              n_days,
              first_day_min,
              last_day_min,
              trend_pct,
              range_pct,
              cv_daily_mins,
              title_key AS group_key
            FROM numbered
            LIMIT 120
            """).replace("/*GK*/", gk());

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("name", name)
                .addValue("days", days);

        List<Map<String, Object>> rawRows = jdbc.queryForList(mainSql, params);

        List<Map<String, Object>> dailyBySeries = new ArrayList<>();
        if (!rawRows.isEmpty()) {
            List<String> titleKeys = new ArrayList<>();
            for (Map<String, Object> row : rawRows) {
                Object g = row.get("group_key");
                if (g != null) titleKeys.add(g.toString());
            }

            String dailySql = ("""
                WITH params AS (
                  SELECT CAST(:name AS text) AS raw_name, CAST(:days AS int) AS days_window
                ),
                candidates AS (
                  SELECT a.id
                  FROM articles a
                  WHERE a.enabled = TRUE
                    AND a.article ILIKE '%' || trim(CAST(:name AS text)) || '%'
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
                    /*GK*/ AS title_key,
                    r.title AS title_raw,
                    r.product_key AS result_product_key,
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
                WHERE title_key IN (:titleKeys)
                ORDER BY title_key, d
                """).replace("/*GK*/", gk());

            MapSqlParameterSource dParams = new MapSqlParameterSource()
                    .addValue("name", name)
                    .addValue("days", days)
                    .addValue("titleKeys", titleKeys);

            List<Map<String, Object>> dailyRows = jdbc.queryForList(dailySql, dParams);

            Map<String, List<Map<String, Object>>> byKey = new HashMap<>();
            for (Map<String, Object> row : dailyRows) {
                String tk = row.get("title_key") == null ? "" : row.get("title_key").toString();
                Object minP = row.get("min_price");
                double price;
                if (minP instanceof Number n) price = n.doubleValue();
                else price = Double.parseDouble(String.valueOf(minP));
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("day", row.get("day"));
                point.put("min_price", price);
                byKey.computeIfAbsent(tk, k -> new ArrayList<>()).add(point);
            }

            for (Map<String, Object> r : rawRows) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("series_id", r.get("series_id"));
                entry.put("product_title", r.get("product_title"));
                entry.put("sample_listing_title", r.get("sample_listing_title"));
                String key = r.get("group_key") == null ? "" : r.get("group_key").toString();
                entry.put("points", byKey.getOrDefault(key, List.of()));
                dailyBySeries.add(entry);
            }
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("days", days);
        body.put("count", rawRows.size());
        body.put("rows", rawRows);
        body.put("daily_by_series", dailyBySeries);
        return ResponseEntity.ok(body);
    }

    /** Brecha vs peers (mismas fichas candidatas; última corrida; mediana en pares). */
    @GetMapping("/peer-gap-by-name")
    public ResponseEntity<?> peerGapByName(
            @RequestParam(value = "name", required = false, defaultValue = "") String nameRaw) {

        String name = nameRaw == null ? "" : nameRaw.trim();
        if (name.length() < 2) {
            return ResponseEntity.status(400).body(
                    Map.of("error", "Query param name is required (min 2 characters)"));
        }

        String sql = ("""
            WITH candidates AS (
              SELECT a.id, a.article, a.brand, a.detail
              FROM articles a
              WHERE a.enabled = TRUE
                AND a.article ILIKE '%' || trim(CAST(:name AS text)) || '%'
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
            ref_pick AS (
              SELECT DISTINCT ON (lr.article_id)
                lr.article_id,
                /*GK*/ AS ref_group_key
              FROM latest_run lr
              INNER JOIN results r ON r.scrape_run_id = lr.run_id AND r.search_id = lr.article_id
              WHERE r.price IS NOT NULL AND r.price > 0
              ORDER BY lr.article_id, r.price ASC NULLS LAST, r.id ASC
            ),
            latest_run_price AS (
              SELECT rp.article_id, MIN(r.price)::float8 AS ref_min, rp.ref_group_key
              FROM ref_pick rp
              INNER JOIN latest_run lr ON lr.article_id = rp.article_id
              INNER JOIN results r ON r.scrape_run_id = lr.run_id AND r.search_id = lr.article_id
              WHERE r.price IS NOT NULL
                AND r.price > 0
                AND /*GK*/ = rp.ref_group_key
              GROUP BY rp.article_id, rp.ref_group_key
            ),
            ranked AS (
              SELECT
                c.id,
                c.article,
                c.brand,
                c.detail,
                my.ref_min AS my_ref_min,
                my.ref_group_key,
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
              ref_group_key,
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
            """).replace("/*GK*/", gk());

        List<Map<String, Object>> rows = jdbc.queryForList(sql, new MapSqlParameterSource("name", name));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("count", rows.size());
        body.put("rows", rows);
        return ResponseEntity.ok(body);
    }

    /** Saltos de precio entre días consecutivos por encima de un umbral. */
    @GetMapping("/price-jumps-by-name")
    public ResponseEntity<?> priceJumpsByName(
            @RequestParam(value = "name", required = false, defaultValue = "") String nameRaw,
            @RequestParam(value = "days", required = false) Integer daysRaw,
            @RequestParam(value = "threshold_pct", required = false) Integer thrPctRaw) {

        String name = nameRaw == null ? "" : nameRaw.trim();
        int days = (daysRaw != null && ALLOWED_DAYS.contains(daysRaw)) ? daysRaw : 30;
        int thrPct = Math.min(100, Math.max(1, thrPctRaw == null ? 15 : thrPctRaw));
        double thr = thrPct / 100.0;

        if (name.length() < 2) {
            return ResponseEntity.status(400).body(
                    Map.of("error", "Query param name is required (min 2 characters)"));
        }

        String sql = ("""
            WITH params AS (
              SELECT trim(CAST(:name AS text)) AS raw_name, CAST(:days AS int) AS days_window, CAST(:thr AS float8) AS thr
            ),
            candidates AS (
              SELECT a.id
              FROM articles a
              WHERE a.enabled = TRUE
                AND a.article ILIKE '%' || trim(CAST(:name AS text)) || '%'
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
                /*GK*/ AS title_key,
                r.title AS title_raw,
                r.product_key AS result_product_key,
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
              SELECT
                title_key,
                CASE
                  WHEN trim(max(coalesce(rr.result_product_key, ''))) <> ''
                  THEN trim(max(rr.result_product_key))
                  ELSE (array_agg(rr.title_raw ORDER BY rr.executed_at DESC, rr.search_id))[1]::text
                END AS product_title,
                (array_agg(rr.title_raw ORDER BY rr.executed_at DESC, rr.search_id))[1]::text AS sample_listing_title
              FROM result_rows rr
              GROUP BY title_key
            ),
            title_meta AS (
              SELECT rr.title_key, COUNT(DISTINCT rr.search_id)::int AS n_articles, MIN(rr.search_id)::int AS primary_article_id
              FROM result_rows rr
              GROUP BY rr.title_key
            )
            SELECT
              pp.product_title,
              pp.sample_listing_title,
              tm.n_articles,
              tm.primary_article_id,
              b.title_key AS group_key,
              to_char(wp.day_start, 'YYYY-MM-DD') AS day_from,
              to_char(wp.day_end, 'YYYY-MM-DD') AS day_to,
              wp.worst_jump_pct AS max_jump_pct
            FROM by_title b
            INNER JOIN worst_pair wp ON wp.title_key = b.title_key
            INNER JOIN product_pick pp ON pp.title_key = b.title_key
            INNER JOIN title_meta tm ON tm.title_key = b.title_key
            ORDER BY b.max_jump_pct DESC, pp.product_title ASC
            LIMIT 120
            """).replace("/*GK*/", gk());

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("name", name)
                .addValue("days", days)
                .addValue("thr", thr);

        List<Map<String, Object>> rows = jdbc.queryForList(sql, params);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("days", days);
        body.put("threshold_pct", thrPct);
        body.put("count", rows.size());
        body.put("rows", rows);
        return ResponseEntity.ok(body);
    }
}
