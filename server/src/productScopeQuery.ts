import type { Request } from "express";

/** `productTitle` + opcional `seller` en query: acotan analíticas / informe / listados. */
export function parseProductScopeQuery(req: Request): {
  manual: boolean;
  productTitle: string;
  sellerOrNull: string | null;
} {
  const productTitle =
    typeof req.query.productTitle === "string" ? req.query.productTitle.trim() : "";
  const sellerRaw = typeof req.query.seller === "string" ? req.query.seller.trim() : "";
  return {
    manual: productTitle.length > 0,
    productTitle,
    sellerOrNull: sellerRaw.length > 0 ? sellerRaw : null,
  };
}
