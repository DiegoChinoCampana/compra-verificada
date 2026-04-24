import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prepareExpressRequestUrl, vercelExpressHandler } from "../vercelExpressBridge.js";

/**
 * Catch-all de Express para `/api/*` que no tenga handler más específico
 * (`api/articles/[id].ts`, `api/analytics/[...path].ts`, etc.).
 */
export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  prepareExpressRequestUrl(req);
  await vercelExpressHandler(req, res);
}
