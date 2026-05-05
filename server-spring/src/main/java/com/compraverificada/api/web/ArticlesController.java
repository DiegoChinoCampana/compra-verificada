package com.compraverificada.api.web;

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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/articles")
public class ArticlesController {

    private final NamedParameterJdbcTemplate jdbc;

    public ArticlesController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Lista artículos con filtros opcionales por nombre / marca / detalle / habilitado. */
    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(value = "article", required = false, defaultValue = "") String article,
            @RequestParam(value = "brand", required = false, defaultValue = "") String brand,
            @RequestParam(value = "detail", required = false, defaultValue = "") String detail,
            @RequestParam(value = "enabled", required = false) String enabledRaw) {
        Boolean enabled = "true".equalsIgnoreCase(enabledRaw)
                ? Boolean.TRUE
                : "false".equalsIgnoreCase(enabledRaw)
                    ? Boolean.FALSE
                    : null;

        String sql = """
            SELECT
              id,
              article,
              brand,
              detail,
              enabled,
              created_at,
              last_scraped_at,
              ordered_by,
              official_store_required,
              free_shipping_required
            FROM articles
            WHERE (CAST(:article AS text) = '' OR article ILIKE '%' || CAST(:article AS text) || '%')
              AND (CAST(:brand AS text) = '' OR COALESCE(brand, '') ILIKE '%' || CAST(:brand AS text) || '%')
              AND (CAST(:detail AS text) = '' OR COALESCE(detail, '') ILIKE '%' || CAST(:detail AS text) || '%')
              AND (CAST(:enabled AS boolean) IS NULL OR enabled = CAST(:enabled AS boolean))
            ORDER BY id DESC
            LIMIT 500
            """;

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("article", article == null ? "" : article.trim())
                .addValue("brand", brand == null ? "" : brand.trim())
                .addValue("detail", detail == null ? "" : detail.trim())
                .addValue("enabled", enabled);

        return jdbc.queryForList(sql, params);
    }

    /** Listados scrapeados de un artículo (paginado, con scope opcional canónico/título/key). */
    @GetMapping("/{id}/results")
    public ResponseEntity<?> resultsForArticle(
            @PathVariable("id") int articleId,
            @RequestParam(value = "limit", required = false) Integer limitRaw,
            @RequestParam(value = "page", required = false) Integer pageRaw,
            @RequestParam(value = "sort", required = false) String sortRaw,
            @RequestParam(value = "productKey", required = false) String productKey,
            @RequestParam(value = "productTitle", required = false) String productTitle,
            @RequestParam(value = "seller", required = false) String seller) {

        Integer exists = jdbc.query(
                "SELECT 1 AS x FROM articles WHERE id = :articleId",
                new MapSqlParameterSource("articleId", articleId),
                rs -> rs.next() ? 1 : null);
        if (exists == null) {
            return ResponseEntity.status(404).body(Map.of("error", "Article not found"));
        }

        int limit = Math.min(500, Math.max(1, limitRaw == null ? 100 : limitRaw));
        int page = Math.max(1, pageRaw == null ? 1 : pageRaw);
        int offset = (page - 1) * limit;

        ProductScopeQuery pq = ProductScopeQuery.parse(productKey, productTitle, seller);
        ProductScopeQuery.Mode mode = pq.mode();

        String scopeF = mode == ProductScopeQuery.Mode.KEY
                ? SqlSnippets.whereProductKey("r", "productKey")
                : mode == ProductScopeQuery.Mode.TITLE
                    ? SqlSnippets.whereManualProductTitleAndSeller("r", "productTitle", "seller")
                    : "TRUE";
        String scopeWhere = pq.manual ? "AND " + scopeF : "";

        boolean sortByProductKey = "product_key".equals(sortRaw == null ? "" : sortRaw.trim());
        String orderBy = sortByProductKey
                ? "(CASE WHEN NULLIF(trim(coalesce(r.product_key, '')), '') IS NULL THEN 1 ELSE 0 END) ASC,\n"
                + "       lower(trim(coalesce(r.product_key, ''))) ASC NULLS LAST,\n"
                + "       sr.executed_at DESC NULLS LAST,\n"
                + "       r.id DESC"
                : "sr.executed_at DESC NULLS LAST, r.id DESC";

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("articleId", articleId)
                .addValue("limit", limit)
                .addValue("offset", offset);
        pq.addScopeParams(params);

        Integer total = jdbc.queryForObject(
                "SELECT COUNT(*)::int AS n FROM results r WHERE r.search_id = :articleId " + scopeWhere,
                params,
                Integer.class);

        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT\n" +
                "  r.id,\n" +
                "  r.scrape_run_id,\n" +
                "  sr.executed_at AS run_executed_at,\n" +
                "  r.title,\n" +
                "  r.price::float8 AS price,\n" +
                "  r.rating::float8 AS rating,\n" +
                "  r.url,\n" +
                "  r.seller,\n" +
                "  r.seller_score,\n" +
                "  r.created_at,\n" +
                "  r.scrape_run_criteria,\n" +
                "  r.official_store_required,\n" +
                "  r.official_store_applied,\n" +
                "  r.free_shipping_required,\n" +
                "  r.free_shipping_applied,\n" +
                "  r.product_key,\n" +
                "  r.product_cluster_id,\n" +
                "  r.product_confidence::float8 AS product_confidence\n" +
                "FROM results r\n" +
                "INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id\n" +
                "WHERE r.search_id = :articleId " + scopeWhere + "\n" +
                "ORDER BY " + orderBy + "\n" +
                "LIMIT :limit OFFSET :offset",
                params);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("total", total == null ? 0 : total);
        body.put("limit", limit);
        body.put("page", page);
        body.put("offset", offset);
        body.put("rows", rows);
        return ResponseEntity.ok(body);
    }

    /** Detalle de un artículo. */
    @GetMapping("/{id}")
    public ResponseEntity<?> getOne(@PathVariable("id") int id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, article, brand, detail, enabled, created_at, last_scraped_at, ordered_by, "
                        + "official_store_required, free_shipping_required FROM articles WHERE id = :id",
                new MapSqlParameterSource("id", id));
        if (rows.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "Article not found"));
        }
        return ResponseEntity.ok(rows.get(0));
    }
}
