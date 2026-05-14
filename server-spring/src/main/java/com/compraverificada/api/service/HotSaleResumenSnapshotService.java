package com.compraverificada.api.service;

import com.compraverificada.api.sql.SqlSnippets;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Lectura Hot Sale en el resumen público: última corrida (cualquier tienda) vs ancla del primer día
 * (misma lógica que {@link HotSaleRoundupService}).
 */
@Service
public class HotSaleResumenSnapshotService {

    private static final Set<Integer> ALLOWED_DAYS = Set.of(10, 30, 60);

    private final NamedParameterJdbcTemplate jdbc;

    public HotSaleResumenSnapshotService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static String snapshotSql() {
        return SNAPSHOT_SQL_TEMPLATE
                .replace("/*GK*/", SqlSnippets.productGroupingKey("r"))
                .replace("/*CF*/", " AND " + SqlSnippets.whereRespectClusterWhenPresent("r"))
                .replace("/*SK*/", SqlSnippets.normSeller("r"));
    }

    private static final String SNAPSHOT_SQL_TEMPLATE = """
            WITH params AS (
              SELECT CAST(:days AS int) AS days_window
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
              WHERE r.search_id = :articleId
                AND r.price IS NOT NULL AND r.price > 0
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
              WHERE r.search_id = :articleId
                AND r.price IS NOT NULL AND r.price > 0
                AND sr.executed_at >= NOW() - interval '365 days'
              ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
            ),
            run_cheapest_key AS (
              SELECT DISTINCT ON (d.search_id, d.scrape_run_id)
                d.search_id,
                d.scrape_run_id,
                d.executed_at,
                /*GK*/ AS gk
              FROM runs_one_per_day_canonical d
              INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
              WHERE r.price IS NOT NULL AND r.price > 0/*CF*/
                AND length(trim(/*GK*/)) > 0
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
              WHERE r.price IS NOT NULL AND r.price > 0/*CF*/
                AND /*GK*/ = ck.canonical_gk
                AND length(trim(/*GK*/)) > 0
              ORDER BY d.search_id, d.executed_at ASC
            ),
            anchor_seller AS (
              SELECT DISTINCT ON (fr.search_id)
                fr.search_id,
                /*SK*/ AS seller_key
              FROM first_run_for_article fr
              INNER JOIN canonical_per_article ck ON ck.search_id = fr.search_id
              INNER JOIN results r ON r.search_id = fr.search_id AND r.scrape_run_id = fr.scrape_run_id
              WHERE r.price IS NOT NULL AND r.price > 0/*CF*/
                AND /*GK*/ = ck.canonical_gk
              ORDER BY fr.search_id, r.price ASC NULLS LAST, r.id ASC
            ),
            run_mins AS (
              SELECT d.search_id, d.scrape_run_id, d.executed_at, MIN(r.price)::float8 AS min_price
              FROM runs_one_per_day d
              INNER JOIN canonical_per_article ck ON ck.search_id = d.search_id
              INNER JOIN anchor_seller an ON an.search_id = d.search_id
              INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
              WHERE r.price IS NOT NULL AND r.price > 0/*CF*/
                AND /*GK*/ = ck.canonical_gk
                AND /*SK*/ = an.seller_key
              GROUP BY d.search_id, d.scrape_run_id, d.executed_at
            ),
            run_mins_market AS (
              SELECT d.search_id, d.scrape_run_id, d.executed_at, MIN(r.price)::float8 AS min_price
              FROM runs_one_per_day d
              INNER JOIN canonical_per_article ck ON ck.search_id = d.search_id
              INNER JOIN results r ON r.search_id = d.search_id AND r.scrape_run_id = d.scrape_run_id
              WHERE r.price IS NOT NULL AND r.price > 0/*CF*/
                AND /*GK*/ = ck.canonical_gk
              GROUP BY d.search_id, d.scrape_run_id, d.executed_at
            ),
            last_market AS (
              SELECT search_id, scrape_run_id, executed_at, min_price
              FROM run_mins_market
              WHERE search_id = :articleId
              ORDER BY executed_at DESC
              LIMIT 1
            ),
            first_market AS (
              SELECT search_id, scrape_run_id, executed_at, min_price
              FROM run_mins_market
              WHERE search_id = :articleId
              ORDER BY executed_at ASC
              LIMIT 1
            ),
            first_anchor AS (
              SELECT search_id, scrape_run_id, executed_at, min_price
              FROM run_mins
              WHERE search_id = :articleId
              ORDER BY executed_at ASC
              LIMIT 1
            ),
            anchor_daily AS (
              SELECT date_trunc('day', executed_at)::date AS d, MIN(min_price)::float8 AS day_min
              FROM run_mins
              WHERE search_id = :articleId
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
                SELECT (/*SK*/)::text
                FROM results r
                INNER JOIN last_market lm2 ON lm2.scrape_run_id = r.scrape_run_id AND lm2.search_id = r.search_id
                INNER JOIN canonical_per_article ck ON ck.search_id = r.search_id
                WHERE r.search_id = :articleId
                  AND r.price IS NOT NULL AND r.price > 0/*CF*/
                  AND /*GK*/ = ck.canonical_gk
                  AND r.price = lm2.min_price
                ORDER BY r.id ASC
                LIMIT 1
              ) AS last_run_cheapest_seller,
              fa.min_price::float8 AS anchor_first_min,
              fm.min_price::float8 AS market_first_min,
              COALESCE(aw.w_max, 0)::float8 AS anchor_max_in_window,
              an.seller_key::text AS anchor_seller
            FROM last_market lm
            INNER JOIN first_market fm ON fm.search_id = lm.search_id
            INNER JOIN first_anchor fa ON fa.search_id = lm.search_id
            CROSS JOIN anchor_w_max aw
            INNER JOIN anchor_seller an ON an.search_id = lm.search_id
            """;

    /** Mismo shape JSON que el backend Node ({@code hotSaleResumen}). */
    public Map<String, Object> fetchOrNull(int articleId, Integer daysRaw) {
        if (daysRaw == null || !ALLOWED_DAYS.contains(daysRaw)) {
            return null;
        }
        int days = daysRaw;
        List<Map<String, Object>> rows = jdbc.queryForList(
                snapshotSql(),
                new MapSqlParameterSource("articleId", articleId).addValue("days", days));
        if (rows.isEmpty()) {
            return null;
        }
        Map<String, Object> r = rows.get(0);
        Double lastRunMinAny = asDouble(r.get("last_run_min_any"));
        Double marketFirstMin = asDouble(r.get("market_first_min"));
        Double anchorFirstMin = asDouble(r.get("anchor_first_min"));
        Double anchorMaxInWindow = asDouble(r.get("anchor_max_in_window"));
        Object lastAt = r.get("last_run_at");
        if (lastRunMinAny == null || lastRunMinAny <= 0
                || marketFirstMin == null || marketFirstMin <= 0
                || anchorFirstMin == null || anchorFirstMin <= 0
                || anchorMaxInWindow == null || !Double.isFinite(anchorMaxInWindow)
                || lastAt == null) {
            return null;
        }

        double marketTrendPct = (lastRunMinAny - marketFirstMin) / marketFirstMin;

        String lastRunCheapestSeller = stringifyOrNull(r.get("last_run_cheapest_seller"));
        String anchorSeller = stringifyOrNull(r.get("anchor_seller"));

        double eps = Math.max(0.01, anchorFirstMin * 0.002);
        boolean loweredEnough = lastRunMinAny < anchorFirstMin - eps;
        boolean otherStore = anchorSeller != null && lastRunCheapestSeller != null
                && !lastRunCheapestSeller.equals(anchorSeller);
        boolean otherStoreBeatAnchor = loweredEnough && otherStore;

        String lastRunIso;
        if (lastAt instanceof Timestamp ts) {
            lastRunIso = ts.toInstant().toString();
        } else {
            lastRunIso = Instant.parse(String.valueOf(lastAt)).toString();
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("days", days);
        out.put("lastRunAt", lastRunIso);
        out.put("lastRunMinAny", lastRunMinAny);
        out.put("marketFirstMin", marketFirstMin);
        out.put("marketTrendPct", marketTrendPct);
        out.put("lastRunCheapestSeller", lastRunCheapestSeller);
        out.put("anchorSeller", anchorSeller);
        out.put("anchorFirstMin", anchorFirstMin);
        out.put("anchorMaxInWindow", anchorMaxInWindow);
        out.put("otherStoreBeatAnchor", otherStoreBeatAnchor);
        return out;
    }

    private static String stringifyOrNull(Object v) {
        if (v == null) {
            return null;
        }
        String s = String.valueOf(v).trim();
        return s.isEmpty() ? null : s;
    }

    private static Double asDouble(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(v));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
