package com.compraverificada.api.web;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/results")
public class ResultsController {

    private final NamedParameterJdbcTemplate jdbc;

    public ResultsController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> list(
            @RequestParam(value = "article", required = false, defaultValue = "") String article,
            @RequestParam(value = "brand", required = false, defaultValue = "") String brand,
            @RequestParam(value = "detail", required = false, defaultValue = "") String detail,
            @RequestParam(value = "title", required = false, defaultValue = "") String title,
            @RequestParam(value = "seller", required = false, defaultValue = "") String seller,
            @RequestParam(value = "limit", required = false) Integer limitRaw,
            @RequestParam(value = "page", required = false) Integer pageRaw,
            @RequestParam(value = "sort", required = false) String sortRaw) {

        int limit = Math.min(200, Math.max(1, limitRaw == null ? 50 : limitRaw));
        int page = Math.max(1, pageRaw == null ? 1 : pageRaw);
        int offset = (page - 1) * limit;

        boolean sortByProductKey = "product_key".equals(sortRaw == null ? "" : sortRaw.trim());
        String orderBy = sortByProductKey
                ? "(CASE WHEN NULLIF(trim(coalesce(r.product_key, '')), '') IS NULL THEN 1 ELSE 0 END) ASC,\n"
                + "       lower(trim(coalesce(r.product_key, ''))) ASC NULLS LAST,\n"
                + "       sr.executed_at DESC NULLS LAST,\n"
                + "       r.created_at DESC"
                : "r.created_at DESC";

        String where = """
              (CAST(:article AS text) = '' OR a.article ILIKE '%' || CAST(:article AS text) || '%')
              AND (CAST(:brand AS text) = '' OR COALESCE(a.brand, '') ILIKE '%' || CAST(:brand AS text) || '%')
              AND (CAST(:detail AS text) = '' OR COALESCE(a.detail, '') ILIKE '%' || CAST(:detail AS text) || '%')
              AND (CAST(:title AS text) = '' OR COALESCE(r.title, '') ILIKE '%' || CAST(:title AS text) || '%')
              AND (CAST(:seller AS text) = '' OR COALESCE(r.seller, '') ILIKE '%' || CAST(:seller AS text) || '%')
            """;

        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("article", article)
                .addValue("brand", brand)
                .addValue("detail", detail)
                .addValue("title", title)
                .addValue("seller", seller)
                .addValue("limit", limit)
                .addValue("offset", offset);

        Integer total = jdbc.queryForObject(
                "SELECT COUNT(*)::int AS n\n"
                        + "FROM results r\n"
                        + "INNER JOIN articles a ON a.id = r.search_id\n"
                        + "INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id\n"
                        + "WHERE " + where,
                params, Integer.class);

        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT\n"
                        + "  r.id AS result_id,\n"
                        + "  r.search_id AS article_id,\n"
                        + "  a.article,\n"
                        + "  a.brand,\n"
                        + "  a.detail,\n"
                        + "  r.title,\n"
                        + "  r.seller,\n"
                        + "  r.price::float8 AS price,\n"
                        + "  r.rating::float8 AS rating,\n"
                        + "  r.url,\n"
                        + "  r.created_at,\n"
                        + "  sr.id AS scrape_run_id,\n"
                        + "  sr.executed_at AS run_executed_at,\n"
                        + "  r.product_key,\n"
                        + "  r.product_cluster_id,\n"
                        + "  r.product_confidence::float8 AS product_confidence\n"
                        + "FROM results r\n"
                        + "INNER JOIN articles a ON a.id = r.search_id\n"
                        + "INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id\n"
                        + "WHERE " + where + "\n"
                        + "ORDER BY " + orderBy + "\n"
                        + "LIMIT :limit OFFSET :offset",
                params);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("total", total == null ? 0 : total);
        body.put("limit", limit);
        body.put("page", page);
        body.put("offset", offset);
        body.put("rows", rows);
        return body;
    }
}
