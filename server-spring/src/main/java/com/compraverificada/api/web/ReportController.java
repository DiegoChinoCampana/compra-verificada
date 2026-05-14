package com.compraverificada.api.web;

import com.compraverificada.api.service.HotSaleRoundupService;
import com.compraverificada.api.service.RecommendationService;
import com.compraverificada.api.sql.ProductScopeQuery;
import com.compraverificada.api.sql.SqlSnippets;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/report")
public class ReportController {

    private final NamedParameterJdbcTemplate jdbc;
    private final RecommendationService recommendation;
    private final HotSaleRoundupService hotSaleRoundupService;

    public ReportController(
            NamedParameterJdbcTemplate jdbc,
            RecommendationService recommendation,
            HotSaleRoundupService hotSaleRoundupService) {
        this.jdbc = jdbc;
        this.recommendation = recommendation;
        this.hotSaleRoundupService = hotSaleRoundupService;
    }

    private static String wrapWithCte(boolean useCte, String body) {
        return (useCte
                ? "WITH " + SqlSnippets.canonicalProductTitleCte()
                : "WITH " + SqlSnippets.runsOnePerDayCte())
                + "\n" + body;
    }

    /** Guía Hot Sale (mismo contrato que Node {@code GET /api/report/hot-sale-roundup}). */
    @GetMapping("/hot-sale-roundup")
    public ResponseEntity<?> hotSaleRoundup(
            @RequestParam(value = "days", required = false) Integer daysRaw) {
        return hotSaleRoundupService.hotSaleRoundup(daysRaw);
    }

    @GetMapping("/article/{articleId}")
    public ResponseEntity<?> articleReport(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {

        ProductScopeQuery pq = ProductScopeQuery.parse(productKey, productTitle, seller);
        ProductScopeQuery.Mode mode = pq.mode();
        boolean useCte = mode == ProductScopeQuery.Mode.CANONICAL;
        String wfR = pq.whereProductScope("r");
        String wfRes = pq.whereProductScope("results");

        List<Map<String, Object>> articleRows = jdbc.queryForList(
                "SELECT id, article, brand, detail, enabled, created_at, last_scraped_at, ordered_by, "
                        + "official_store_required, free_shipping_required FROM articles WHERE id = :articleId",
                new MapSqlParameterSource("articleId", articleId));
        if (articleRows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "Article not found"));
        }
        Map<String, Object> article = articleRows.get(0);

        MapSqlParameterSource baseParams = new MapSqlParameterSource()
                .addValue("articleId", articleId);
        pq.addScopeParams(baseParams);

        // ---- price-series ----
        String priceSeriesSql = wrapWithCte(useCte, """
            SELECT sr.id AS scrape_run_id, sr.executed_at,
                   MIN(r.price)::float8 AS min_price,
                   AVG(r.price)::float8 AS avg_price,
                   COUNT(*)::int AS listing_count
            FROM results r
            JOIN scrape_runs sr ON sr.id = r.scrape_run_id
            JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
            WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            GROUP BY sr.id, sr.executed_at
            ORDER BY sr.executed_at ASC
            """).replace("/*WF*/", wfR);
        List<Map<String, Object>> priceSeries = jdbc.queryForList(priceSeriesSql, baseParams);

        // ---- best-per-run ----
        String bestSql = wrapWithCte(useCte, """
            , ranked AS (
              SELECT sr.id AS scrape_run_id, sr.executed_at, r.title,
                     r.price::float8 AS price, r.url, r.seller, r.rating::float8 AS rating,
                     ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
              FROM results r
              JOIN scrape_runs sr ON sr.id = r.scrape_run_id
              JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
              WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            )
            SELECT scrape_run_id, executed_at, title, price, url, seller, rating
            FROM ranked WHERE rn = 1 ORDER BY executed_at ASC
            """).replace("/*WF*/", wfR);
        List<Map<String, Object>> bestPerRun = jdbc.queryForList(bestSql, baseParams);

        // ---- dispersion ----
        String dispSql = wrapWithCte(useCte, """
            SELECT sr.id AS scrape_run_id, sr.executed_at,
                   MIN(r.price)::float8 AS min_price,
                   MAX(r.price)::float8 AS max_price,
                   AVG(r.price)::float8 AS avg_price,
                   STDDEV_POP(r.price)::float8 AS stddev_pop,
                   COUNT(*)::int AS listing_count
            FROM results r
            JOIN scrape_runs sr ON sr.id = r.scrape_run_id
            JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
            WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            GROUP BY sr.id, sr.executed_at
            ORDER BY sr.executed_at ASC
            """).replace("/*WF*/", wfR);
        List<Map<String, Object>> dispersionRaw = jdbc.queryForList(dispSql, baseParams);
        List<Map<String, Object>> dispersionEnriched = new ArrayList<>();
        for (Map<String, Object> row : dispersionRaw) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Double avg = asDouble(row.get("avg_price"));
            Double std = asDouble(row.get("stddev_pop"));
            Double cv = (avg != null && avg > 0 && std != null && Double.isFinite(std)) ? std / avg : null;
            copy.put("coefficient_of_variation", cv);
            dispersionEnriched.add(copy);
        }

        // ---- sellers ----
        String sellersInner = """
            SELECT COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
                   COUNT(*)::int AS listing_count,
                   AVG(results.rating)::float8 AS avg_rating,
                   MIN(results.price)::float8 AS min_price_seen,
                   MAX(results.created_at) AS last_seen_at
            FROM results
            WHERE results.search_id = :articleId AND results.created_at > NOW() - interval '90 days'
              AND /*WF*/
            GROUP BY 1
            ORDER BY listing_count DESC
            LIMIT 15
            """.replace("/*WF*/", wfRes);
        String sellersSql = useCte
                ? "WITH " + SqlSnippets.canonicalProductTitleCte() + "\n" + sellersInner
                : sellersInner;
        List<Map<String, Object>> sellers = jdbc.queryForList(sellersSql, baseParams);

        // ---- criteria ----
        String criteriaInner = """
            SELECT COUNT(*)::int AS total_results,
                   COUNT(*) FILTER (WHERE results.official_store_required IS TRUE)::int AS required_official_count,
                   COUNT(*) FILTER (WHERE results.official_store_required IS TRUE AND results.official_store_applied IS TRUE)::int AS official_met_count,
                   COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE)::int AS required_free_ship_count,
                   COUNT(*) FILTER (WHERE results.free_shipping_required IS TRUE AND results.free_shipping_applied IS TRUE)::int AS free_ship_met_count
            FROM results
            WHERE results.search_id = :articleId AND /*WF*/
            """.replace("/*WF*/", wfRes);
        String criteriaSql = useCte
                ? "WITH " + SqlSnippets.canonicalProductTitleCte() + "\n" + criteriaInner
                : criteriaInner;
        List<Map<String, Object>> criteriaRows = jdbc.queryForList(criteriaSql, baseParams);
        Map<String, Object> criteria = criteriaRows.isEmpty() ? Map.of() : criteriaRows.get(0);

        // ---- peers (igual lógica que AnalyticsController.peersByArticleDetail) ----
        List<Map<String, Object>> peers = peersFor(article, pq);

        // ---- scope row ----
        Map<String, Object> scope = scopeRow(articleId, pq);

        // ---- recomendación ----
        Double runToRunTrendPct = null;
        if (priceSeries.size() >= 2) {
            Double prev = asDouble(priceSeries.get(priceSeries.size() - 2).get("min_price"));
            Double last = asDouble(priceSeries.get(priceSeries.size() - 1).get("min_price"));
            if (prev != null && prev > 0 && last != null && Double.isFinite(last)) {
                runToRunTrendPct = (last - prev) / prev;
            }
        }
        Double lastRunCv = null;
        if (!dispersionRaw.isEmpty()) {
            Map<String, Object> last = dispersionRaw.get(dispersionRaw.size() - 1);
            Double avg = asDouble(last.get("avg_price"));
            Double std = asDouble(last.get("stddev_pop"));
            if (avg != null && avg > 0 && std != null && Double.isFinite(std)) {
                lastRunCv = std / avg;
            }
        }

        List<Map<String, Object>> sortedPeers = new ArrayList<>(peers);
        sortedPeers.sort(Comparator.comparingDouble(o -> {
            Double v = asDouble(o.get("latest_run_min_price"));
            return v == null ? Double.POSITIVE_INFINITY : v;
        }));
        int peerRankIndex = -1;
        for (int i = 0; i < sortedPeers.size(); i++) {
            Object id = sortedPeers.get(i).get("id");
            if (id instanceof Number n && n.intValue() == articleId) {
                peerRankIndex = i;
                break;
            }
        }
        if (peerRankIndex < 0) peerRankIndex = 0;

        Map<String, Object> rec = recommendation.build(new RecommendationService.Input(
                peers.isEmpty() ? 0 : peerRankIndex,
                peers.size(),
                runToRunTrendPct,
                lastRunCv));

        // ---- analytics scope (igual a AnalyticsController) ----
        Map<String, Object> analyticsScope = new LinkedHashMap<>();
        Object normTitle = scope == null ? null : scope.get("norm_title");
        analyticsScope.put("hasCanonicalProduct", normTitle != null && !String.valueOf(normTitle).isEmpty());
        analyticsScope.put("scopeMode",
                mode == ProductScopeQuery.Mode.CANONICAL ? "auto"
                        : mode == ProductScopeQuery.Mode.KEY ? "key" : "manual");
        analyticsScope.put("canonicalNormTitle", normTitle);
        analyticsScope.put("displayTitle",
                mode == ProductScopeQuery.Mode.TITLE ? pq.productTitle
                        : mode == ProductScopeQuery.Mode.KEY ? pq.productKey
                            : (scope == null ? null : scope.get("display_title")));
        analyticsScope.put("sellerFilter", mode == ProductScopeQuery.Mode.TITLE ? pq.sellerOrNull : null);

        Map<String, Object> sections = new LinkedHashMap<>();
        sections.put("priceSeries", priceSeries);
        sections.put("bestOfferPerRun", bestPerRun);
        sections.put("dispersionPerRun", dispersionEnriched);
        sections.put("sellers", sellers);
        sections.put("criteriaCompliance", criteria);
        sections.put("peerComparisonByBrand", peers);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("generatedAt", OffsetDateTime.now().toString());
        body.put("article", article);
        body.put("disclaimer",
                "Resumen basado en datos scrapeados; no constituye asesoramiento financiero ni garantía de precio.");
        body.put("analyticsScope", analyticsScope);
        body.put("sections", sections);
        body.put("recommendation", rec);
        return ResponseEntity.ok(body);
    }

    private List<Map<String, Object>> peersFor(Map<String, Object> article, ProductScopeQuery pq) {
        String articleName = article.get("article") == null ? "" : article.get("article").toString();
        String detail = article.get("detail") == null ? "" : article.get("detail").toString();

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("article", articleName)
                .addValue("detail", detail);

        switch (pq.mode()) {
            case KEY: {
                String sql = peersTemplateKey().replace("/*WHERE_KEY*/",
                        SqlSnippets.whereProductKey("r", "productKey"));
                params.addValue("productKey", pq.productKey == null ? "" : pq.productKey);
                return jdbc.queryForList(sql, params);
            }
            case TITLE: {
                String sql = peersTemplateManual().replace("/*WHERE_TS*/",
                        SqlSnippets.whereManualProductTitleAndSeller("r", "productTitle", "seller"));
                params.addValue("productTitle", pq.productTitle);
                params.addValue("seller", pq.sellerOrNull);
                return jdbc.queryForList(sql, params);
            }
            default: {
                String sql = peersTemplateAuto()
                        .replace("/*GK2*/", SqlSnippets.productGroupingKey("r2"))
                        .replace("/*GKR*/", SqlSnippets.productGroupingKey("r"))
                        .replace("/*CF2*/", " AND " + SqlSnippets.whereRespectClusterWhenPresent("r2"))
                        .replace("/*CFR*/", " AND " + SqlSnippets.whereRespectClusterWhenPresent("r"));
                return jdbc.queryForList(sql, params);
            }
        }
    }

    private Map<String, Object> scopeRow(int articleId, ProductScopeQuery pq) {
        switch (pq.mode()) {
            case KEY: {
                String sql = "SELECT trim(CAST(:productKey AS text)) AS norm_title, "
                        + "trim(CAST(:productKey AS text)) AS display_title";
                return jdbc.queryForMap(sql,
                        new MapSqlParameterSource("productKey", pq.productKey == null ? "" : pq.productKey));
            }
            case TITLE: {
                String sql = "SELECT trim(both from regexp_replace(lower(trim(CAST(:productTitle AS text))), E'\\\\s+', ' ', 'g')) AS norm_title, "
                        + "CAST(:productTitle AS text) AS display_title";
                return jdbc.queryForMap(sql,
                        new MapSqlParameterSource("productTitle", pq.productTitle));
            }
            default: {
                String sql = "WITH " + SqlSnippets.canonicalProductTitleCte()
                        + "\nSELECT norm_title, display_title FROM canonical_norm_title";
                List<Map<String, Object>> rows = jdbc.queryForList(sql,
                        new MapSqlParameterSource("articleId", articleId));
                return rows.isEmpty() ? null : rows.get(0);
            }
        }
    }

    // ---- Templates de peers (idénticos a los de AnalyticsController; replicados para no acoplar). ----

    private static String peersTemplateAuto() {
        return """
            WITH grp AS (
              SELECT id, article, brand, detail, enabled
              FROM articles
              WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
                AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
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
                    /*GK2*/ AS norm_title,
                    r2.price,
                    ROW_NUMBER() OVER (PARTITION BY sr2.id ORDER BY r2.price ASC NULLS LAST) AS rn
                  FROM results r2
                  INNER JOIN scrape_runs sr2 ON sr2.id = r2.scrape_run_id
                  INNER JOIN rod ON rod.scrape_run_id = sr2.id
                  WHERE r2.search_id = g.id AND r2.price IS NOT NULL/*CF2*/
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
              WHERE (canon.norm_title IS NULL
                OR /*GKR*/ = canon.norm_title)/*CFR*/
              GROUP BY g.id, sr.id, sr.executed_at
            ),
            per_day AS (
              SELECT DISTINCT ON (p.article_id, date_trunc('day', p.executed_at))
                p.article_id, p.executed_at, p.min_p
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
            ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
            """;
    }

    private static String peersTemplateManual() {
        return """
            WITH grp AS (
              SELECT id, article, brand, detail, enabled
              FROM articles
              WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
                AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
            ),
            per_article_run AS (
              SELECT g.id AS article_id, sr.id AS run_id, sr.executed_at, MIN(r.price) AS min_p
              FROM grp g
              INNER JOIN results r ON r.search_id = g.id AND r.price IS NOT NULL
              INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
              WHERE /*WHERE_TS*/
              GROUP BY g.id, sr.id, sr.executed_at
            ),
            per_day AS (
              SELECT DISTINCT ON (p.article_id, date_trunc('day', p.executed_at))
                p.article_id, p.executed_at, p.min_p
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
            ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
            """;
    }

    private static String peersTemplateKey() {
        return """
            WITH grp AS (
              SELECT id, article, brand, detail, enabled
              FROM articles
              WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
                AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
            ),
            per_article_run AS (
              SELECT g.id AS article_id, sr.id AS run_id, sr.executed_at, MIN(r.price) AS min_p
              FROM grp g
              INNER JOIN results r ON r.search_id = g.id AND r.price IS NOT NULL
              INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
              WHERE /*WHERE_KEY*/
              GROUP BY g.id, sr.id, sr.executed_at
            ),
            per_day AS (
              SELECT DISTINCT ON (p.article_id, date_trunc('day', p.executed_at))
                p.article_id, p.executed_at, p.min_p
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
            ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
            """;
    }

    private static Double asDouble(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(v)); } catch (NumberFormatException e) { return null; }
    }
}
