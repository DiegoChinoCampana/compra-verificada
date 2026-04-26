import type { Request } from "express";
import {
  sqlWhereManualProductTitleAndSeller,
  sqlWhereProductKey,
  sqlWhereTitleMatchesCanonical,
} from "./sql/articleSameProductTitle.js";

export type ProductScopeMode = "canonical" | "title" | "key";

export type ParsedProductScope = {
  /** true si hay `productTitle` o `productKey` en la query (alcance acotado). */
  manual: boolean;
  /** true si viene `productKey` (prioridad sobre título). */
  byProductKey: boolean;
  productKey: string | null;
  productTitle: string;
  sellerOrNull: string | null;
};

/** `productTitle` / `productKey` + opcional `seller` en query: acotan analíticas / informe / listados. */
export function parseProductScopeQuery(req: Request): ParsedProductScope {
  const productKey =
    typeof req.query.productKey === "string" ? req.query.productKey.trim() : "";
  const productTitle =
    typeof req.query.productTitle === "string" ? req.query.productTitle.trim() : "";
  const sellerRaw = typeof req.query.seller === "string" ? req.query.seller.trim() : "";
  const byProductKey = productKey.length > 0;
  return {
    byProductKey,
    productKey: byProductKey ? productKey : null,
    productTitle,
    sellerOrNull: sellerRaw.length > 0 ? sellerRaw : null,
    manual: byProductKey || productTitle.length > 0,
  };
}

export function productScopeMode(pq: ParsedProductScope): ProductScopeMode {
  if (pq.byProductKey && pq.productKey) return "key";
  if (pq.productTitle.trim().length > 0) return "title";
  return "canonical";
}

type ResultsAlias = "r" | "results";

/**
 * Filtro SQL sobre filas de `results` según alcance (canónico / título manual / `product_key`).
 * Los índices son posiciones de placeholder `$` en la consulta final (mismo orden que `scopeParamsAfterArticle`).
 */
export function sqlWhereProductScope(
  pq: ParsedProductScope,
  alias: ResultsAlias,
  idx: { title: number; seller: number; key: number },
): string {
  switch (productScopeMode(pq)) {
    case "key":
      return sqlWhereProductKey(alias, idx.key);
    case "title":
      return `(${sqlWhereManualProductTitleAndSeller(alias, idx.title, idx.seller)})`;
    default:
      return `(${sqlWhereTitleMatchesCanonical(alias)})`;
  }
}

/** Parámetros que siguen a `$1` = `article_id` en rutas típicas (p. ej. título+seller o `productKey`). */
export function scopeParamsAfterArticleId(pq: ParsedProductScope): unknown[] {
  switch (productScopeMode(pq)) {
    case "key":
      return [pq.productKey ?? ""];
    case "title":
      return [pq.productTitle, pq.sellerOrNull];
    default:
      return [];
  }
}
