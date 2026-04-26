/** Query `productKey` y/o `productTitle` + opcional `seller` para tablero / informe / listados acotados. */
export function productScopeQueryString(
  productTitle: string | null | undefined,
  seller: string | null | undefined,
  productKey?: string | null | undefined,
): string {
  const q = new URLSearchParams();
  const pk = productKey?.trim();
  if (pk) {
    q.set("productKey", pk);
    const str = q.toString();
    return str ? `?${str}` : "";
  }
  const t = productTitle?.trim();
  const s = seller?.trim();
  if (t) q.set("productTitle", t);
  if (s) q.set("seller", s);
  const str = q.toString();
  return str ? `?${str}` : "";
}

/**
 * `group_key` de análisis = misma clave que en servidor (`COALESCE(product_key, título normalizado)`).
 * Si empieza con `cluster:` es un `product_key` de batch semántico.
 */
export function productScopeFromGroupKey(groupKey: string | null | undefined): string {
  const g = (groupKey ?? "").trim();
  if (!g) return "";
  if (g.startsWith("cluster:")) {
    return productScopeQueryString(null, null, g);
  }
  return productScopeQueryString(g, null);
}
