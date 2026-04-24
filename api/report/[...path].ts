import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeRequestUrl, vercelExpressHandler } from "../../vercelExpressBridge.js";

export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  normalizeRequestUrl(req, "/api/report");
  await vercelExpressHandler(req, res);
}
