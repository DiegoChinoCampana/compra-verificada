package com.compraverificada.api.sql;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

/**
 * Equivalente a {@code server/src/productScopeQuery.ts} del backend Node.
 * Centraliza el parsing de {@code productKey} / {@code productTitle} / {@code seller}
 * que llega por query params y la composición del WHERE SQL.
 */
public final class ProductScopeQuery {

    public enum Mode { CANONICAL, TITLE, KEY }

    public final boolean manual;
    public final boolean byProductKey;
    public final String productKey;   // null si no aplica
    public final String productTitle; // "" si no aplica
    public final String sellerOrNull; // null si no aplica

    private ProductScopeQuery(boolean manual, boolean byKey, String productKey,
                              String productTitle, String sellerOrNull) {
        this.manual = manual;
        this.byProductKey = byKey;
        this.productKey = productKey;
        this.productTitle = productTitle;
        this.sellerOrNull = sellerOrNull;
    }

    public static ProductScopeQuery parse(String productKeyRaw, String productTitleRaw, String sellerRaw) {
        String productKey = productKeyRaw == null ? "" : productKeyRaw.trim();
        String productTitle = productTitleRaw == null ? "" : productTitleRaw.trim();
        String seller = sellerRaw == null ? "" : sellerRaw.trim();
        boolean byKey = !productKey.isEmpty();
        boolean manual = byKey || !productTitle.isEmpty();
        return new ProductScopeQuery(
                manual,
                byKey,
                byKey ? productKey : null,
                productTitle,
                seller.isEmpty() ? null : seller
        );
    }

    public Mode mode() {
        if (byProductKey && productKey != null) return Mode.KEY;
        if (productTitle != null && !productTitle.trim().isEmpty()) return Mode.TITLE;
        return Mode.CANONICAL;
    }

    /**
     * Filtro SQL sobre filas de {@code alias} ({@code "r"} o {@code "results"}) según el modo:
     * canónico (CTE), título manual o {@code product_key}.
     */
    public String whereProductScope(String alias) {
        switch (mode()) {
            case KEY:
                return SqlSnippets.whereProductKey(alias, "productKey");
            case TITLE:
                return "(" + SqlSnippets.whereManualProductTitleAndSeller(
                        alias, "productTitle", "seller") + ")";
            default:
                return "(" + SqlSnippets.whereTitleMatchesCanonical(alias) + ")";
        }
    }

    /**
     * Agrega los parámetros que dependen del modo. Asume que {@code articleId} ya está
     * cargado por el caller (los demás parámetros — limit, offset, days — también).
     */
    public void addScopeParams(MapSqlParameterSource params) {
        switch (mode()) {
            case KEY:
                params.addValue("productKey", productKey == null ? "" : productKey);
                break;
            case TITLE:
                params.addValue("productTitle", productTitle);
                params.addValue("seller", sellerOrNull);
                break;
            default:
                break;
        }
    }
}
