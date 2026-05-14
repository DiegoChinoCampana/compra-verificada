package com.compraverificada.api.sql;

/**
 * Snippets SQL idénticos a los del backend Node ({@code server/src/sql/*.ts}).
 * Se mantienen los mismos textos / CTEs para garantizar el mismo shape de datos.
 *
 * <p>Convención: los placeholders usan parámetros nombrados ({@code :name}) compatibles con
 * {@link org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate}. Los casts
 * Postgres se escriben como {@code CAST(:x AS text)} para evitar conflictos con el operador
 * {@code ::} en algunas versiones del parser de NamedParameter.
 */
public final class SqlSnippets {
    private SqlSnippets() {}

    /** Normaliza título: minúsculas + colapso de whitespace. */
    public static String normTitle(String alias) {
        return "trim(both from regexp_replace(lower(coalesce(" + alias
                + ".title, '')), E'\\\\s+', ' ', 'g'))";
    }

    /**
     * Tienda/vendedor normalizado; vacío → {@code (sin tienda)} (igual que en Node
     * {@code sqlNormSeller}).
     */
    public static String normSeller(String alias) {
        String collapsed = "trim(both from regexp_replace(lower(coalesce(" + alias
                + ".seller, '')), E'\\\\s+', ' ', 'g'))";
        return "COALESCE(NULLIF(" + collapsed + ", ''), '(sin tienda)')";
    }

    /**
     * Clave de agrupación estable: {@code product_key} si existe, si no el título normalizado.
     */
    public static String productGroupingKey(String alias) {
        return "COALESCE(NULLIF(trim(" + alias + ".product_key), ''), " + normTitle(alias) + ")";
    }

    /** Filtra exactamente por {@code product_key}, parámetro nombrado en {@code :param}. */
    public static String whereProductKey(String alias, String param) {
        return "(trim(coalesce(" + alias + ".product_key, '')) = trim(CAST(:" + param + " AS text)))";
    }

    /**
     * Filtro por título normalizado de publicación y, opcional, vendedor (LIKE).
     * Si {@code :sellerParam} es null o vacío, no filtra por vendedor.
     */
    public static String whereManualProductTitleAndSeller(String alias, String titleParam, String sellerParam) {
        String n = normTitle(alias);
        return "(\n" +
                "  " + n + " = trim(both from regexp_replace(lower(trim(CAST(:" + titleParam + " AS text))), E'\\\\s+', ' ', 'g'))\n" +
                "  AND (\n" +
                "    CAST(:" + sellerParam + " AS text) IS NULL\n" +
                "    OR length(trim(CAST(:" + sellerParam + " AS text))) = 0\n" +
                "    OR coalesce(trim(" + alias + ".seller), '') ILIKE '%' || trim(CAST(:" + sellerParam + " AS text)) || '%'\n" +
                "  )\n" +
                ")";
    }

    /**
     * CTE para un artículo dado ({@code :articleId}): una corrida por día calendario
     * (la más reciente de cada día, con al menos un precio).
     */
    public static String runsOnePerDayCte() {
        return "runs_one_per_day AS (\n" +
                "  SELECT DISTINCT ON (date_trunc('day', sr.executed_at))\n" +
                "    sr.id AS scrape_run_id,\n" +
                "    sr.executed_at\n" +
                "  FROM results r\n" +
                "  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id\n" +
                "  WHERE r.search_id = :articleId AND r.price IS NOT NULL\n" +
                "  ORDER BY date_trunc('day', sr.executed_at), sr.executed_at DESC\n" +
                ")";
    }

    /**
     * CTE: para un artículo ({@code :articleId}), elegir el título canónico (moda entre los
     * ganadores por corrida; desempate por corrida más reciente). Devuelve {@code norm_title}
     * y {@code display_title}.
     *
     * <p>Requiere encadenar con {@link #runsOnePerDayCte()} (lo incluye al inicio).
     */
    public static String canonicalProductTitleCte() {
        return runsOnePerDayCte() + ",\n" +
                "per_run_price_rank AS (\n" +
                "  SELECT\n" +
                "    sr.id AS scrape_run_id,\n" +
                "    sr.executed_at,\n" +
                "    " + productGroupingKey("r") + " AS norm_title,\n" +
                "    r.title AS raw_title,\n" +
                "    r.product_key AS result_product_key,\n" +
                "    r.price::float8 AS price,\n" +
                "    ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn\n" +
                "  FROM results r\n" +
                "  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id\n" +
                "  INNER JOIN runs_one_per_day d ON d.scrape_run_id = sr.id\n" +
                "  WHERE r.search_id = :articleId AND r.price IS NOT NULL\n" +
                "    AND " + whereRespectClusterWhenPresent("r") + "\n" +
                "),\n" +
                "canonical_norm_title AS (\n" +
                "  SELECT\n" +
                "    mode_norm.norm_title,\n" +
                "    (\n" +
                "      SELECT CASE\n" +
                "        WHEN mk.has_key THEN mk.key_text\n" +
                "        ELSE mk.fallback_title\n" +
                "      END\n" +
                "      FROM (\n" +
                "        SELECT\n" +
                "          trim(max(coalesce(pr.result_product_key, ''))) <> '' AS has_key,\n" +
                "          trim(max(pr.result_product_key)) AS key_text,\n" +
                "          (array_agg(pr.raw_title ORDER BY pr.executed_at DESC))[1]::text AS fallback_title\n" +
                "        FROM per_run_price_rank pr\n" +
                "        WHERE pr.rn = 1 AND pr.norm_title = mode_norm.norm_title\n" +
                "      ) mk\n" +
                "    ) AS display_title\n" +
                "  FROM (\n" +
                "    SELECT pr.norm_title\n" +
                "    FROM per_run_price_rank pr\n" +
                "    WHERE pr.rn = 1 AND pr.norm_title <> ''\n" +
                "    GROUP BY pr.norm_title\n" +
                "    ORDER BY COUNT(*) DESC, MAX(pr.executed_at) DESC\n" +
                "    LIMIT 1\n" +
                "  ) mode_norm\n" +
                ")";
    }

    /** Filtro: misma fila pertenece al título canónico (si no hay canónico, no filtra). */
    public static String whereTitleMatchesCanonical(String alias) {
        String gk = productGroupingKey(alias);
        return "(\n" +
                "  NOT EXISTS (SELECT 1 FROM canonical_norm_title)\n" +
                "  OR " + gk + " = (SELECT c.norm_title FROM canonical_norm_title c)\n" +
                ")";
    }

    /**
     * Si en la misma corrida hay al menos un listado con {@code product_key}, excluye filas sin clave
     * al calcular mínimos / canónico / peers.
     */
    public static String whereRespectClusterWhenPresent(String alias) {
        return "(\n" +
                "  NOT EXISTS (\n" +
                "    SELECT 1 FROM results r_ck\n" +
                "    WHERE r_ck.search_id = " + alias + ".search_id\n" +
                "      AND r_ck.scrape_run_id = " + alias + ".scrape_run_id\n" +
                "      AND r_ck.price IS NOT NULL\n" +
                "      AND NULLIF(trim(r_ck.product_key), '') IS NOT NULL\n" +
                "  )\n" +
                "  OR NULLIF(trim(" + alias + ".product_key), '') IS NOT NULL\n" +
                ")";
    }
}
