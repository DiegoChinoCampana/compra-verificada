/** Query `productTitle` + opcional `seller` para tablero / informe / listados acotados. */
export function productScopeQueryString(
  productTitle: string | null | undefined,
  seller: string | null | undefined,
): string {
  const q = new URLSearchParams();
  const t = productTitle?.trim();
  const s = seller?.trim();
  if (t) q.set("productTitle", t);
  if (s) q.set("seller", s);
  const str = q.toString();
  return str ? `?${str}` : "";
}
