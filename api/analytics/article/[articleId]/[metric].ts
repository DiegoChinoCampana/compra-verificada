import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../../../vercelExpressBridge.js";

export const config = { maxDuration: 120 };

function first(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : "";
}

/**
 * /api/analytics/article/:id/:metric (price-series, dispersion, criteria, …).
 * El catch-all `api/analytics/[...path].ts` no matchea en Vercel con outputDirectory del SPA.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const articleId = first(req.query.articleId);
  const metric = first(req.query.metric);
  if (!articleId || !metric) {
    res.status(400).json({ error: "missing_article_or_metric" });
    return;
  }
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/analytics/article/${encodeURIComponent(articleId)}/${encodeURIComponent(metric)}${search}`;
  (req as VercelRequest & { originalUrl?: string }).originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
