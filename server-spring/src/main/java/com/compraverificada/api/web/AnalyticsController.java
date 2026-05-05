package com.compraverificada.api.web;

import com.compraverificada.api.service.ClusterBatchMetaService;
import com.compraverificada.api.service.ClusterRunAuth;
import com.compraverificada.api.service.EmbeddingService;
import com.compraverificada.api.service.ProductClusteringJob;
import com.compraverificada.api.sql.ProductScopeQuery;
import com.compraverificada.api.sql.SqlSnippets;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/analytics")
public class AnalyticsController {

    private final NamedParameterJdbcTemplate jdbc;
    private final ClusterRunAuth clusterAuth;
    private final ClusterBatchMetaService clusterMeta;
    private final EmbeddingService embeddings;
    private final ProductClusteringJob clusteringJob;

    private static final String NO_RESULT_EMBEDDINGS_HINT =
            "No existe la tabla result_embeddings (hace falta pgvector). En Postgres, como superusuario: " +
            "CREATE EXTENSION IF NOT EXISTS vector; luego ejecutá el bloque de db/schema.sql que crea " +
            "result_embeddings o reiniciá la API para que se cree. Sin eso, embeddings y clustering no pueden correr.";

    public AnalyticsController(NamedParameterJdbcTemplate jdbc,
                               ClusterRunAuth clusterAuth,
                               ClusterBatchMetaService clusterMeta,
                               EmbeddingService embeddings,
                               ProductClusteringJob clusteringJob) {
        this.jdbc = jdbc;
        this.clusterAuth = clusterAuth;
        this.clusterMeta = clusterMeta;
        this.embeddings = embeddings;
        this.clusteringJob = clusteringJob;
    }

    private static ProductScopeQuery scopeFrom(String productKey, String productTitle, String seller) {
        return ProductScopeQuery.parse(productKey, productTitle, seller);
    }

    private static MapSqlParameterSource baseParams(int articleId, ProductScopeQuery pq) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("articleId", articleId);
        pq.addScopeParams(params);
        return params;
    }

    /** Para los endpoints que arman SQL canónico vs no-canónico. */
    private static String wrapWithCte(boolean useCte, String body) {
        if (useCte) {
            return "WITH " + SqlSnippets.canonicalProductTitleCte() + "\n" + body;
        } else {
            return "WITH " + SqlSnippets.runsOnePerDayCte() + "\n" + body;
        }
    }

    @GetMapping("/article/{articleId}/analytics-scope")
    public Map<String, Object> analyticsScope(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {

        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        ProductScopeQuery.Mode mode = pq.mode();
        Map<String, Object> body = new LinkedHashMap<>();

        if (mode == ProductScopeQuery.Mode.KEY) {
            body.put("hasCanonicalProduct", true);
            body.put("scopeMode", "key");
            body.put("canonicalNormTitle", pq.productKey);
            body.put("displayTitle", pq.productKey);
            body.put("sellerFilter", null);
            return body;
        }
        if (mode == ProductScopeQuery.Mode.TITLE) {
            String norm = jdbc.queryForObject(
                    "SELECT trim(both from regexp_replace(lower(trim(CAST(:productTitle AS text))), E'\\\\s+', ' ', 'g')) AS norm_title",
                    new MapSqlParameterSource("productTitle", pq.productTitle), String.class);
            body.put("hasCanonicalProduct", norm != null && !norm.isEmpty());
            body.put("scopeMode", "manual");
            body.put("canonicalNormTitle", (norm == null || norm.isEmpty()) ? null : norm);
            body.put("displayTitle", pq.productTitle);
            body.put("sellerFilter", pq.sellerOrNull);
            return body;
        }
        // canonical (auto)
        String sql = "WITH " + SqlSnippets.canonicalProductTitleCte()
                + "\nSELECT norm_title, display_title FROM canonical_norm_title";
        List<Map<String, Object>> rows = jdbc.queryForList(sql, baseParams(articleId, pq));
        Map<String, Object> row = rows.isEmpty() ? Map.of() : rows.get(0);
        Object norm = row.get("norm_title");
        body.put("hasCanonicalProduct", norm != null && !String.valueOf(norm).isEmpty());
        body.put("scopeMode", "auto");
        body.put("canonicalNormTitle", norm == null ? null : norm);
        body.put("displayTitle", row.get("display_title"));
        body.put("sellerFilter", null);
        return body;
    }

    @GetMapping("/article/{articleId}/price-series")
    public List<Map<String, Object>> priceSeries(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        boolean useCte = pq.mode() == ProductScopeQuery.Mode.CANONICAL;
        String wf = pq.whereProductScope("r");
        String sql = wrapWithCte(useCte, """
            SELECT
              sr.id AS scrape_run_id,
              sr.executed_at,
              MIN(r.price)::float8 AS min_price,
              AVG(r.price)::float8 AS avg_price,
              COUNT(*)::int AS listing_count
            FROM results r
            JOIN scrape_runs sr ON sr.id = r.scrape_run_id
            JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
            WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            GROUP BY sr.id, sr.executed_at
            ORDER BY sr.executed_at ASC
            """).replace("/*WF*/", wf);
        return jdbc.queryForList(sql, baseParams(articleId, pq));
    }

    @GetMapping("/article/{articleId}/best-per-run")
    public List<Map<String, Object>> bestPerRun(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        boolean useCte = pq.mode() == ProductScopeQuery.Mode.CANONICAL;
        String wf = pq.whereProductScope("r");
        String sql = wrapWithCte(useCte, """
            , ranked AS (
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
              WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            )
            SELECT scrape_run_id, executed_at, title, price, url, seller, rating
            FROM ranked WHERE rn = 1 ORDER BY executed_at ASC
            """).replace("/*WF*/", wf);
        return jdbc.queryForList(sql, baseParams(articleId, pq));
    }

    @GetMapping("/article/{articleId}/dispersion")
    public List<Map<String, Object>> dispersion(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        boolean useCte = pq.mode() == ProductScopeQuery.Mode.CANONICAL;
        String wf = pq.whereProductScope("r");
        String sql = wrapWithCte(useCte, """
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
            WHERE r.search_id = :articleId AND r.price IS NOT NULL AND /*WF*/
            GROUP BY sr.id, sr.executed_at
            ORDER BY sr.executed_at ASC
            """).replace("/*WF*/", wf);
        List<Map<String, Object>> rows = jdbc.queryForList(sql, baseParams(articleId, pq));
        List<Map<String, Object>> enriched = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            Double avg = asDouble(row.get("avg_price"));
            Double std = asDouble(row.get("stddev_pop"));
            Double cv = (avg != null && avg > 0 && std != null && Double.isFinite(std)) ? std / avg : null;
            copy.put("coefficient_of_variation", cv);
            enriched.add(copy);
        }
        return enriched;
    }

    @GetMapping("/article/{articleId}/sellers")
    public List<Map<String, Object>> sellers(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "days", required = false) Integer daysRaw,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {
        int days = Math.min(365, Math.max(7, daysRaw == null ? 90 : daysRaw));
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        boolean useCte = pq.mode() == ProductScopeQuery.Mode.CANONICAL;
        String wf = pq.whereProductScope("results");

        String inner = """
            SELECT
              COALESCE(NULLIF(TRIM(results.seller), ''), '(sin vendedor)') AS seller,
              COUNT(*)::int AS listing_count,
              AVG(results.rating)::float8 AS avg_rating,
              MIN(results.price)::float8 AS min_price_seen,
              MAX(results.created_at) AS last_seen_at
            FROM results
            WHERE results.search_id = :articleId
              AND results.created_at > NOW() - (CAST(:days AS int) * interval '1 day')
              AND /*WF*/
            GROUP BY 1
            ORDER BY listing_count DESC
            LIMIT 30
            """.replace("/*WF*/", wf);
        String sql = useCte
                ? "WITH " + SqlSnippets.canonicalProductTitleCte() + "\n" + inner
                : inner;

        MapSqlParameterSource params = baseParams(articleId, pq).addValue("days", days);
        return jdbc.queryForList(sql, params);
    }

    @GetMapping("/article/{articleId}/criteria")
    public Map<String, Object> criteria(
            @PathVariable("articleId") int articleId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        boolean useCte = pq.mode() == ProductScopeQuery.Mode.CANONICAL;
        String wf = pq.whereProductScope("results");

        String inner = """
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
            WHERE results.search_id = :articleId AND /*WF*/
            """.replace("/*WF*/", wf);
        String sql = useCte
                ? "WITH " + SqlSnippets.canonicalProductTitleCte() + "\n" + inner
                : inner;
        List<Map<String, Object>> rows = jdbc.queryForList(sql, baseParams(articleId, pq));
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    @GetMapping("/operational/stale-scrapes")
    public List<Map<String, Object>> staleScrapes(@RequestParam(value = "days", required = false) Integer daysRaw) {
        int days = Math.min(90, Math.max(1, daysRaw == null ? 7 : daysRaw));
        return jdbc.queryForList(
                "SELECT id, article, brand, detail, last_scraped_at, enabled FROM articles "
                        + "WHERE enabled = TRUE AND ("
                        + "  last_scraped_at IS NULL OR last_scraped_at < NOW() - (CAST(:days AS int) * interval '1 day')"
                        + ") ORDER BY last_scraped_at NULLS FIRST LIMIT 200",
                new MapSqlParameterSource("days", days));
    }

    @GetMapping("/operational/missing-recent-results")
    public List<Map<String, Object>> missingRecentResults(@RequestParam(value = "days", required = false) Integer daysRaw) {
        int days = Math.min(90, Math.max(1, daysRaw == null ? 14 : daysRaw));
        return jdbc.queryForList(
                "SELECT a.id, a.article, a.brand, a.detail, a.last_scraped_at FROM articles a "
                        + "WHERE a.enabled = TRUE AND NOT EXISTS ("
                        + "  SELECT 1 FROM results r WHERE r.search_id = a.id AND r.created_at > NOW() - (CAST(:days AS int) * interval '1 day')"
                        + ") ORDER BY a.id LIMIT 200",
                new MapSqlParameterSource("days", days));
    }

    private boolean resultEmbeddingsTableExists() {
        Boolean e = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_name = 'result_embeddings') AS e",
                new MapSqlParameterSource(), Boolean.class);
        return Boolean.TRUE.equals(e);
    }

    @GetMapping("/operational/product-clustering-meta")
    public Map<String, Object> clusteringMeta() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("lastRun", clusterMeta.read());
        boolean ready = resultEmbeddingsTableExists();
        if (!ready) {
            body.put("counts", null);
            body.put("countsError", NO_RESULT_EMBEDDINGS_HINT);
            body.put("embeddingsTableReady", false);
            body.put("requiresClusterBatchSecret", clusterAuth.requiresClientSecret());
            body.put("openAiConfigured", embeddings.isApiKeyConfigured());
            return body;
        }
        try {
            Map<String, Object> counts = jdbc.queryForMap("""
                SELECT
                  (SELECT COUNT(*)::int FROM results r
                   WHERE r.product_key IS NOT NULL AND length(trim(r.product_key)) > 0) AS with_product_key,
                  (SELECT COUNT(*)::int FROM result_embeddings) AS with_embedding,
                  (SELECT COUNT(*)::int FROM results) AS total_results
                """, new MapSqlParameterSource());
            body.put("counts", counts);
        } catch (RuntimeException e) {
            body.put("counts", null);
            body.put("countsError", e.getMessage());
        }
        body.put("embeddingsTableReady", true);
        body.put("requiresClusterBatchSecret", clusterAuth.requiresClientSecret());
        body.put("openAiConfigured", embeddings.isApiKeyConfigured());
        return body;
    }

    @PostMapping("/operational/product-clustering-run")
    public ResponseEntity<?> clusteringRun(
            @RequestHeader(value = "X-Cluster-Batch-Secret", required = false) String headerSecret,
            @RequestBody(required = false) Map<String, Object> body) {

        Map<String, Object> b = body == null ? Map.of() : body;
        String secret = headerSecret != null ? headerSecret : asString(b.get("secret"));
        clusterAuth.assertAuthorized(secret);

        if (!resultEmbeddingsTableExists()) {
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", false);
            resp.put("error", NO_RESULT_EMBEDDINGS_HINT);
            return ResponseEntity.status(503).body(resp);
        }

        String article = asString(b.get("article"));
        if (article == null || article.trim().length() < 2) {
            return ResponseEntity.status(400).body(Map.of("error",
                    "body.article es obligatorio (mín. 2 caracteres)"));
        }

        ProductClusteringJob.Input input = new ProductClusteringJob.Input();
        input.article = article;
        input.days = asInt(b.get("days"));
        input.limit = asInt(b.get("limit"));
        input.batchSize = asInt(b.get("batchSize"));
        input.minSimilarity = asDouble(b.get("minSimilarity"));
        input.minPts = asInt(b.get("minPts"));
        input.centroidMergeMinSimilarity = asDouble(b.get("centroidMergeMinSimilarity"));
        input.skipCentroidMerge = asBoolOrNull(b.get("skipCentroidMerge"));
        input.pairwiseMergeMinSimilarity = asDouble(b.get("pairwiseMergeMinSimilarity"));
        input.skipPairwiseMerge = asBoolOrNull(b.get("skipPairwiseMerge"));
        input.titleAnchorMinLen = asInt(b.get("titleAnchorMinLen"));
        input.skipTitleAnchorMerge = asBoolOrNull(b.get("skipTitleAnchorMerge"));
        input.embedOnly = asBoolOrNull(b.get("embedOnly"));
        input.clusterOnly = asBoolOrNull(b.get("clusterOnly"));
        input.resetArticleWindow = asBoolOrNull(b.get("resetArticleWindow"));
        input.resetScope = asBoolOrNull(b.get("resetScope"));

        Map<String, Object> result = clusteringJob.run(input);
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("ok", true);
        ok.put("result", result);
        return ResponseEntity.ok(ok);
    }

    // ---- Peers ----

    private static final String PEERS_AUTO_SQL_TEMPLATE = """
        WITH grp AS (
          SELECT id, article, brand, detail, enabled
          FROM articles
          WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
            AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
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
                /*GK2*/ AS norm_title,
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
            OR /*GKR*/ = canon.norm_title
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
        WHERE (CAST(:excludeId AS int) IS NULL OR g.id <> CAST(:excludeId AS int))
        ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
        """;

    private static final String PEERS_MANUAL_SQL_TEMPLATE = """
        WITH grp AS (
          SELECT id, article, brand, detail, enabled
          FROM articles
          WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
            AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
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
          WHERE /*WHERE_TS*/
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
        WHERE (CAST(:excludeId AS int) IS NULL OR g.id <> CAST(:excludeId AS int))
        ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
        """;

    private static final String PEERS_KEY_SQL_TEMPLATE = """
        WITH grp AS (
          SELECT id, article, brand, detail, enabled
          FROM articles
          WHERE lower(trim(article)) = lower(trim(CAST(:article AS text)))
            AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce(CAST(:detail AS text), '')))
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
          WHERE /*WHERE_KEY*/
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
        WHERE (CAST(:excludeId AS int) IS NULL OR g.id <> CAST(:excludeId AS int))
        ORDER BY l.min_p ASC NULLS LAST, g.brand ASC NULLS LAST
        """;

    @GetMapping("/peers/by-article-detail")
    public ResponseEntity<?> peersByArticleDetail(
            @RequestParam("article") String article,
            @RequestParam(value = "detail", required = false, defaultValue = "") String detail,
            @RequestParam(value = "excludeId", required = false) Integer excludeId,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {

        if (article == null || article.trim().isEmpty()) {
            return ResponseEntity.status(400).body(Map.of("error", "Query param article is required"));
        }
        ProductScopeQuery pq = scopeFrom(productKey, productTitle, seller);
        ProductScopeQuery.Mode mode = pq.mode();

        String sql;
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("article", article.trim())
                .addValue("detail", detail.trim())
                .addValue("excludeId", excludeId);

        if (mode == ProductScopeQuery.Mode.KEY) {
            sql = PEERS_KEY_SQL_TEMPLATE.replace("/*WHERE_KEY*/",
                    SqlSnippets.whereProductKey("r", "productKey"));
            params.addValue("productKey", pq.productKey == null ? "" : pq.productKey);
        } else if (mode == ProductScopeQuery.Mode.TITLE) {
            sql = PEERS_MANUAL_SQL_TEMPLATE.replace("/*WHERE_TS*/",
                    SqlSnippets.whereManualProductTitleAndSeller("r", "productTitle", "seller"));
            params.addValue("productTitle", pq.productTitle);
            params.addValue("seller", pq.sellerOrNull);
        } else {
            sql = PEERS_AUTO_SQL_TEMPLATE
                    .replace("/*GK2*/", SqlSnippets.productGroupingKey("r2"))
                    .replace("/*GKR*/", SqlSnippets.productGroupingKey("r"));
        }

        return ResponseEntity.ok(jdbc.queryForList(sql, params));
    }

    // ---- Helpers de coerción de tipos para el body JSON ----

    private static Double asDouble(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(v)); } catch (NumberFormatException e) { return null; }
    }

    private static Integer asInt(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(v).trim()); } catch (NumberFormatException e) { return null; }
    }

    private static Boolean asBoolOrNull(Object v) {
        if (v == null) return null;
        if (v instanceof Boolean b) return b;
        return null;
    }

    private static String asString(Object v) {
        return v == null ? null : v.toString();
    }
}
