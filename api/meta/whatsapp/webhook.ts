import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../../../lib/vercelExpressBridge.js";

/**
 * POST/GET https://…/api/meta/whatsapp/webhook
 * Handler dedicado (evita depender solo del catch-all `api/[...slug].ts`).
 */
export const config = { maxDuration: 120 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.url ?? "/";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/meta/whatsapp/webhook${search}`;
  const ext = req as VercelRequest & { originalUrl?: string };
  ext.originalUrl = req.url;
  await vercelExpressHandler(req, res);
}
