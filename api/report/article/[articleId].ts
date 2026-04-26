import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../../lib/vercelExpressBridge.js";

export const config = { maxDuration: 120 };

function firstSegment(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : "";
}

/**
 * GET /api/report/article/:articleId — handler dedicado (mismo patrón que
 * `api/articles/[id].ts`). Con `outputDirectory` + SPA, el catch-all
 * `api/report/[...path].ts` puede no matchear y Vercel devuelve NOT_FOUND.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const articleId = firstSegment(req.query.articleId);
  if (!articleId) {
    res.status(400).json({ error: "missing_article_id" });
    return;
  }
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/report/article/${encodeURIComponent(articleId)}${search}`;
  const ext = req as VercelRequest & { originalUrl?: string };
  ext.originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
