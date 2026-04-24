import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../../../vercelExpressBridge.js";

export const config = { maxDuration: 120 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/analytics/operational/stale-scrapes${search}`;
  (req as VercelRequest & { originalUrl?: string }).originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
