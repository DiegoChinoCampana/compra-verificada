import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeRequestUrl, vercelExpressHandler } from "../../lib/vercelExpressBridge.js";

export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  normalizeRequestUrl(req, "/api/analysis");
  await vercelExpressHandler(req, res);
}
