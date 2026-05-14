package com.compraverificada.api.service;

import com.compraverificada.api.sql.SqlSnippets;
import com.compraverificada.api.web.HotSaleNarrative;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Guía Hot Sale: productos votados en Instagram + top fichas con precio a la baja.
 * El {@code GET} HTTP vive en {@link com.compraverificada.api.web.ReportController} para compartir
 * {@code /report} con el informe y evitar registro duplicado o estático 404.
 */
@Service
public class HotSaleRoundupService {

    private static String trendsSql() {
        return TRENDS_SQL_TEMPLATE
                .replace("/*GK*/", SqlSnippets.productGroupingKey("r"))
                .replace("/*CF*/", " AND " + SqlSnippets.whereRespectClusterWhenPresent("r"))
                .replace("/*SK*/", SqlSnippets.normSeller("r"));

    }

    private static final String TRENDS_SQL_TEMPLATE = """
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
              WHERE r.price IS NOT NULL AND r.price > 0
                AND sr.executed_at >= NOW() - (p.days_window * interval '1 day')
              ORDER BY r.search_id, date_trunc('day', sr.executed_at), sr.executed_at DESC
            ),
            run_cheapest_key AS (
              SELECT DISTINCT ON (d.search_id, d.scrape_run_id)
                d.search_id,
                d.scrape_run_id,
                d.executed_at,
                /*GK*/ AS gk
              FROM runs_one_per_day d
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
            daily AS (
              SELECT search_id,
                date_trunc('day', executed_at)::date AS d,
                MIN(min_price)::float8 AS day_min
              FROM run_mins
              GROUP BY search_id, date_trunc('day', executed_at)::date
            ),
            window_stats AS (
              SELECT search_id,
                MIN(day_min)::float8 AS w_min,
                MAX(day_min)::float8 AS w_max,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY day_min)::float8 AS w_median
              FROM daily
              GROUP BY search_id
              HAVING COUNT(*) >= 2
            ),
            dod AS (
              SELECT search_id, day_min,
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
              SELECT e.search_id AS article_id, e.first_min, e.last_min, e.n_points,
                CASE WHEN e.first_min > 0 THEN ((e.last_min - e.first_min) / e.first_min)::float8 END AS trend_pct,
                ws.w_min, ws.w_max, ws.w_median, ds.max_dod_drop_pct
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
              SELECT search_id,
                MIN(day_min)::float8 AS w_min,
                MAX(day_min)::float8 AS w_max,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY day_min)::float8 AS w_median
              FROM daily_market
              GROUP BY search_id
              HAVING COUNT(*) >= 2
            ),
            dod_market AS (
              SELECT search_id, day_min,
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
              SELECT e.search_id AS article_id, e.first_min, e.last_min, e.n_points,
                CASE WHEN e.first_min > 0 THEN ((e.last_min - e.first_min) / e.first_min)::float8 END AS trend_pct,
                ws.w_min, ws.w_max, ws.w_median, ds.max_dod_drop_pct
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
            """;

    private record ArticleMatch(String articleFrag, String brandFrag, String detailFrag) {
        static ArticleMatch of(String a, String b, String d) {
            return new ArticleMatch(
                    a == null ? "" : a,
                    b == null ? "" : b,
                    d == null ? "" : d);
        }

        boolean isUsable() {
            return !articleFrag.isEmpty() || !brandFrag.isEmpty() || !detailFrag.isEmpty();
        }
    }

    private record VotedSlot(String pollLabel, String instagramLabel, Integer articleId, ArticleMatch match) {}

    private record EnrichedVote(
            VotedSlot slot,
            Integer effectiveArticleId,
            boolean resolvedByMatch,
            boolean approximateMatch) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class VotedSlotJson {
        public String pollLabel;
        public String instagramLabel;
        public Integer articleId;
        public MatchJson match;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class MatchJson {
        public String article;
        public String brand;
        public String detail;
    }

    private static final Logger log = LoggerFactory.getLogger(HotSaleRoundupService.class);
    private static final String HOT_SALE_CONFIG_NAME = "hot_sale_voted_slots";

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public HotSaleRoundupService(NamedParameterJdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public ResponseEntity<?> hotSaleRoundup(Integer daysRaw) {
        int days = parseDays(daysRaw);
        MapSqlParameterSource p = new MapSqlParameterSource("days", days);
        List<Map<String, Object>> trendRows = jdbc.queryForList(trendsSql(), p);

        Map<Integer, Map<String, Object>> trendByArticle = new LinkedHashMap<>();
        for (Map<String, Object> row : trendRows) {
            Object idObj = row.get("article_id");
            if (!(idObj instanceof Number n)) {
                continue;
            }
            trendByArticle.put(n.intValue(), row);
        }

        List<VotedSlot> slots = loadVotedSlots();
        List<EnrichedVote> enriched = enrichVotes(slots);

        Set<Integer> votedIds = enriched.stream()
                .map(EnrichedVote::effectiveArticleId)
                .filter(id -> id != null && id > 0)
                .collect(Collectors.toCollection(LinkedHashSet::new));

        List<Integer> linkedIds = enriched.stream()
                .map(EnrichedVote::effectiveArticleId)
                .filter(id -> id != null && id > 0)
                .distinct()
                .toList();

        Map<Integer, Map<String, Object>> articlesMeta = fetchArticlesMeta(linkedIds);

        List<Map<String, Object>> voted = new ArrayList<>();
        for (EnrichedVote ev : enriched) {
            voted.add(votedRow(ev, trendByArticle, articlesMeta));
        }

        List<Map<String, Object>> topDrops = trendRows.stream()
                .filter(r -> {
                    Object idObj = r.get("article_id");
                    Object trObj = r.get("trend_pct");
                    if (!(idObj instanceof Number nid) || !(trObj instanceof Number tr)) {
                        return false;
                    }
                    return tr.doubleValue() < 0 && !votedIds.contains(nid.intValue());
                })
                .sorted(Comparator.comparingDouble(r -> ((Number) r.get("trend_pct")).doubleValue()))
                .limit(10)
                .map(HotSaleRoundupService::toDropPayload)
                .toList();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("generatedAt", OffsetDateTime.now().toString());
        body.put("days", days);
        body.put("disclaimer",
                "Información orientativa según publicaciones relevadas; los precios pueden cambiar. No es asesoramiento financiero.");
        body.put("voted", voted);
        body.put("topPriceDrops", topDrops);
        return ResponseEntity.ok(body);
    }

    private List<VotedSlot> parseVotedSlotsJson(String json) throws java.io.IOException {
        List<VotedSlotJson> parsed = objectMapper.readValue(json, new TypeReference<>() {});
        List<VotedSlot> out = new ArrayList<>();
        for (VotedSlotJson j : parsed) {
            String poll = j.pollLabel != null ? j.pollLabel : "";
            String insta = j.instagramLabel != null ? j.instagramLabel : "";
            if (poll.isBlank() && insta.isBlank()) {
                continue;
            }
            Integer articleId = j.articleId;
            if (articleId != null && articleId <= 0) {
                articleId = null;
            }
            ArticleMatch match = null;
            if (j.match != null) {
                match = ArticleMatch.of(
                        j.match.article != null ? j.match.article : "",
                        j.match.brand != null ? j.match.brand : "",
                        j.match.detail != null ? j.match.detail : "");
                if (!match.isUsable()) {
                    match = null;
                }
            }
            out.add(new VotedSlot(poll, insta, articleId, match));
        }
        return out;
    }

    private List<VotedSlot> loadVotedSlots() {
        String env = System.getenv("HOT_SALE_VOTED_JSON");
        if (env != null && !env.isBlank()) {
            try {
                return parseVotedSlotsJson(env.trim());
            } catch (Exception e) {
                log.warn("[hotSale] HOT_SALE_VOTED_JSON inválido: {}", e.getMessage());
                return List.of();
            }
        }
        try {
            List<String> vals = jdbc.query(
                    "SELECT value FROM configs WHERE name = :name ORDER BY id DESC LIMIT 1",
                    new MapSqlParameterSource("name", HOT_SALE_CONFIG_NAME),
                    (rs, rowNum) -> rs.getString("value"));
            if (vals.isEmpty() || vals.get(0) == null || vals.get(0).isBlank()) {
                return List.of();
            }
            return parseVotedSlotsJson(vals.get(0).trim());
        } catch (Exception e) {
            log.warn("[hotSale] No se pudieron cargar slots desde configs ({}): {}", HOT_SALE_CONFIG_NAME, e.getMessage());
            return List.of();
        }
    }

    private static int parseDays(Integer raw) {
        int d = raw == null ? 30 : raw;
        if (d == 10 || d == 30 || d == 60) {
            return d;
        }
        return 30;
    }

    /** Más específico → más laxo (p. ej. solo marca). */
    private List<ArticleMatch> articleMatchAttempts(ArticleMatch m) {
        String a = m.articleFrag();
        String b = m.brandFrag();
        String d = m.detailFrag();
        List<ArticleMatch> attempts = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        Consumer<ArticleMatch> add = (match) -> {
            if (!match.isUsable()) {
                return;
            }
            String key = match.articleFrag() + '\u001d' + match.brandFrag() + '\u001d' + match.detailFrag();
            if (seen.add(key)) {
                attempts.add(match);
            }
        };
        add.accept(m);
        if (!d.isEmpty()) {
            add.accept(ArticleMatch.of(a, b, ""));
        }
        if (!a.isEmpty()) {
            add.accept(ArticleMatch.of("", b, d));
        }
        if (!b.isEmpty()) {
            add.accept(ArticleMatch.of("", b, ""));
        }
        if (!a.isEmpty()) {
            add.accept(ArticleMatch.of(a, "", ""));
        }
        if (!d.isEmpty()) {
            add.accept(ArticleMatch.of("", "", d));
        }
        return attempts;
    }

    private record MatchOutcome(Integer articleId, boolean approximateMatch) {}

    private MatchOutcome resolveArticleMatch(ArticleMatch m) {
        if (m == null || !m.isUsable()) {
            return new MatchOutcome(null, false);
        }
        String sql = """
                SELECT id FROM articles
                WHERE enabled = TRUE
                  AND (CAST(:article AS text) = '' OR article ILIKE '%' || CAST(:article AS text) || '%')
                  AND (CAST(:brand AS text) = '' OR COALESCE(brand, '') ILIKE '%' || CAST(:brand AS text) || '%')
                  AND (CAST(:detail AS text) = '' OR COALESCE(detail, '') ILIKE '%' || CAST(:detail AS text) || '%')
                ORDER BY id DESC
                LIMIT 1
                """;
        List<ArticleMatch> attempts = articleMatchAttempts(m);
        for (int i = 0; i < attempts.size(); i++) {
            ArticleMatch attempt = attempts.get(i);
            MapSqlParameterSource p = new MapSqlParameterSource()
                    .addValue("article", attempt.articleFrag())
                    .addValue("brand", attempt.brandFrag())
                    .addValue("detail", attempt.detailFrag());
            List<Map<String, Object>> rows = jdbc.queryForList(sql, p);
            if (!rows.isEmpty()) {
                Object idObj = rows.get(0).get("id");
                if (idObj instanceof Number n) {
                    return new MatchOutcome(n.intValue(), i > 0);
                }
            }
        }
        return new MatchOutcome(null, false);
    }

    private List<EnrichedVote> enrichVotes(List<VotedSlot> slots) {
        List<EnrichedVote> out = new ArrayList<>();
        for (VotedSlot s : slots) {
            if (s.articleId() != null && s.articleId() > 0) {
                out.add(new EnrichedVote(s, s.articleId(), false, false));
                continue;
            }
            ArticleMatch mat = s.match();
            if (mat != null && mat.isUsable()) {
                MatchOutcome mo = resolveArticleMatch(mat);
                Integer rid = mo.articleId();
                boolean resolved = rid != null;
                boolean approx = resolved && mo.approximateMatch();
                out.add(new EnrichedVote(s, rid, resolved, approx));
            } else {
                out.add(new EnrichedVote(s, null, false, false));
            }
        }
        return out;
    }

    private static Map<String, Object> buildNarrativeFromSqlRow(Map<String, Object> row) {
        double firstMin = ((Number) row.get("first_min")).doubleValue();
        double lastMin = ((Number) row.get("last_min")).doubleValue();
        int nPoints = ((Number) row.get("n_points")).intValue();
        double wMax = ((Number) row.get("w_max")).doubleValue();
        double wMedian = ((Number) row.get("w_median")).doubleValue();
        double maxDod = ((Number) row.get("max_dod_drop_pct")).doubleValue();
        Double mf = row.get("market_first_min") instanceof Number n ? n.doubleValue() : null;
        Double ml = row.get("market_last_min") instanceof Number n ? n.doubleValue() : null;
        Double mt = row.get("market_trend_pct") instanceof Number n ? n.doubleValue() : null;
        return HotSaleNarrative.build(firstMin, lastMin, wMax, wMedian, maxDod, nPoints, mf, ml, mt);
    }

    private static Map<String, Object> toDropPayload(Map<String, Object> row) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("article_id", ((Number) row.get("article_id")).intValue());
        m.put("article", row.get("article"));
        m.put("brand", row.get("brand"));
        m.put("detail", row.get("detail"));
        m.put("first_min", row.get("first_min"));
        m.put("last_min", row.get("last_min"));
        m.put("trend_pct", row.get("trend_pct"));
        m.put("n_points", row.get("n_points"));
        m.put("w_min", row.get("w_min"));
        m.put("w_max", row.get("w_max"));
        m.put("w_median", row.get("w_median"));
        m.put("max_dod_drop_pct", row.get("max_dod_drop_pct"));
        m.put("trend_seller", row.get("trend_seller"));
        m.put("market_first_min", row.get("market_first_min"));
        m.put("market_last_min", row.get("market_last_min"));
        m.put("market_trend_pct", row.get("market_trend_pct"));
        m.put("market_n_points", row.get("market_n_points"));
        m.put("market_w_min", row.get("market_w_min"));
        m.put("market_w_max", row.get("market_w_max"));
        m.put("market_w_median", row.get("market_w_median"));
        m.put("market_max_dod_drop_pct", row.get("market_max_dod_drop_pct"));
        m.put("narrative", buildNarrativeFromSqlRow(row));
        return m;
    }

    private Map<Integer, Map<String, Object>> fetchArticlesMeta(List<Integer> ids) {
        Map<Integer, Map<String, Object>> out = new LinkedHashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        String sql = "SELECT id, article, brand, detail FROM articles WHERE id IN (:ids)";
        MapSqlParameterSource p = new MapSqlParameterSource("ids", ids);
        List<Map<String, Object>> rows = jdbc.queryForList(sql, p);
        for (Map<String, Object> r : rows) {
            Object idObj = r.get("id");
            if (idObj instanceof Number n) {
                out.put(n.intValue(), r);
            }
        }
        return out;
    }

    private Map<String, Object> votedRow(
            EnrichedVote ev,
            Map<Integer, Map<String, Object>> trendByArticle,
            Map<Integer, Map<String, Object>> articlesMeta) {
        VotedSlot slot = ev.slot();
        Integer aid = ev.effectiveArticleId();
        boolean resolvedByMatch = ev.resolvedByMatch();

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pollLabel", slot.pollLabel());
        m.put("instagramLabel", slot.instagramLabel());
        m.put("articleId", aid);
        m.put("resolvedByMatch", resolvedByMatch);
        m.put("approximateMatch", aid != null && ev.approximateMatch());
        if (aid == null) {
            m.put("linked", false);
            m.put("article", null);
            m.put("brand", null);
            m.put("detail", null);
            m.put("first_min", null);
            m.put("last_min", null);
            m.put("trend_pct", null);
            m.put("n_points", null);
            m.put("w_min", null);
            m.put("w_max", null);
            m.put("w_median", null);
            m.put("max_dod_drop_pct", null);
            m.put("trend_seller", null);
            m.put("market_first_min", null);
            m.put("market_last_min", null);
            m.put("market_trend_pct", null);
            m.put("market_n_points", null);
            m.put("market_w_min", null);
            m.put("market_w_max", null);
            m.put("market_w_median", null);
            m.put("market_max_dod_drop_pct", null);
            m.put("narrative", null);
            return m;
        }
        Map<String, Object> t = trendByArticle.get(aid);
        Map<String, Object> meta = articlesMeta.get(aid);
        if (t == null) {
            m.put("linked", meta != null);
            m.put("article", meta == null ? null : meta.get("article"));
            m.put("brand", meta == null ? null : meta.get("brand"));
            m.put("detail", meta == null ? null : meta.get("detail"));
            m.put("first_min", null);
            m.put("last_min", null);
            m.put("trend_pct", null);
            m.put("n_points", null);
            m.put("w_min", null);
            m.put("w_max", null);
            m.put("w_median", null);
            m.put("max_dod_drop_pct", null);
            m.put("trend_seller", null);
            m.put("market_first_min", null);
            m.put("market_last_min", null);
            m.put("market_trend_pct", null);
            m.put("market_n_points", null);
            m.put("market_w_min", null);
            m.put("market_w_max", null);
            m.put("market_w_median", null);
            m.put("market_max_dod_drop_pct", null);
            m.put("narrative", null);
            return m;
        }
        m.put("linked", true);
        m.put("article", t.get("article"));
        m.put("brand", t.get("brand"));
        m.put("detail", t.get("detail"));
        m.put("first_min", t.get("first_min"));
        m.put("last_min", t.get("last_min"));
        m.put("trend_pct", t.get("trend_pct"));
        m.put("n_points", t.get("n_points"));
        m.put("w_min", t.get("w_min"));
        m.put("w_max", t.get("w_max"));
        m.put("w_median", t.get("w_median"));
        m.put("max_dod_drop_pct", t.get("max_dod_drop_pct"));
        m.put("trend_seller", t.get("trend_seller"));
        m.put("market_first_min", t.get("market_first_min"));
        m.put("market_last_min", t.get("market_last_min"));
        m.put("market_trend_pct", t.get("market_trend_pct"));
        m.put("market_n_points", t.get("market_n_points"));
        m.put("market_w_min", t.get("market_w_min"));
        m.put("market_w_max", t.get("market_w_max"));
        m.put("market_w_median", t.get("market_w_median"));
        m.put("market_max_dod_drop_pct", t.get("market_max_dod_drop_pct"));
        m.put("narrative", buildNarrativeFromSqlRow(t));
        return m;
    }
}
