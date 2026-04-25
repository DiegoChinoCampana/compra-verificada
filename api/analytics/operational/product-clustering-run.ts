import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../../lib/vercelExpressBridge.js";

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/analytics/operational/product-clustering-run${search}`;
  (req as VercelRequest & { originalUrl?: string }).originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
