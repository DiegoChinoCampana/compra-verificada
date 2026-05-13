import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../lib/vercelExpressBridge.js";

export const config = { maxDuration: 120 };

/**
 * GET /api/report/hot-sale-roundup — handler dedicado (mismo patrón que
 * `api/report/article/[articleId].ts`): el catch-all `api/[...slug].ts` puede
 * no matchear y Vercel devuelve NOT_FOUND.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/report/hot-sale-roundup${search}`;
  const ext = req as VercelRequest & { originalUrl?: string };
  ext.originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
