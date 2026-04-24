import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prepareExpressRequestUrl, vercelExpressHandler } from "../vercelExpressBridge.js";

/**
 * Único catch-all de Express bajo `/api/*` (articles, analytics, report, analysis, results, …).
 * Los handlers anidados `api/articles/[...path].ts` fallaban en Vercel con `outputDirectory` del SPA.
 */
export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  prepareExpressRequestUrl(req);
  await vercelExpressHandler(req, res);
}
