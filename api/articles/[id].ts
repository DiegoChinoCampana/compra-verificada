import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../lib/vercelExpressBridge.js";

export const config = { maxDuration: 120 };

function firstSegment(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : "";
}

/** GET /api/articles/:id — Vercel no enruta bien varios segmentos solo con `api/[...slug].ts` + SPA output. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const id = firstSegment(req.query.id);
  if (!id) {
    res.status(400).json({ error: "missing_id" });
    return;
  }
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/articles/${encodeURIComponent(id)}${search}`;
  const ext = req as VercelRequest & { originalUrl?: string };
  ext.originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
