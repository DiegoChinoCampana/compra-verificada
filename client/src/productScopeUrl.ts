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
    const s = seller?.trim();
    if (s && s.toLowerCase() !== "(sin tienda)") {
      q.set("seller", s);
    }
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
 * `seller` opcional: tienda normalizada del análisis (se omite si es el marcador sin tienda).
 */
export function productScopeFromGroupKey(
  groupKey: string | null | undefined,
  seller?: string | null | undefined,
): string {
  const g = (groupKey ?? "").trim();
  if (!g) return "";
  const sRaw = (seller ?? "").trim();
  const s = sRaw && sRaw.toLowerCase() !== "(sin tienda)" ? sRaw : null;
  if (g.startsWith("cluster:")) {
    return productScopeQueryString(null, s, g);
  }
  return productScopeQueryString(g, s);
}
