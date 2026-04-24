import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../vercelExpressBridge.js";

/**
 * Catch-all bajo `/api` → Express. `[[...slug]]` cubre rutas multi-segmento
 * (`/api/articles/1/results`, `/api/analytics/article/1/price-series`, etc.).
 */
export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await vercelExpressHandler(req, res);
}
