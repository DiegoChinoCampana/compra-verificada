import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prepareExpressRequestUrl, vercelExpressHandler } from "../vercelExpressBridge.js";

/**
 * Catch-all para `/api/*` sin handler más específico (`api/articles/[...path].ts`, etc.):
 * p. ej. `/api/results`, `/api/health`.
 */
export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  prepareExpressRequestUrl(req);
  await vercelExpressHandler(req, res);
}
