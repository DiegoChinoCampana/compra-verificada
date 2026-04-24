import type { VercelRequest, VercelResponse } from "@vercel/node";
import { vercelExpressHandler } from "../vercelExpressBridge.js";

/**
 * Catch-all opcional bajo `/api` → Express. El nombre `[[...slug]]` evita que Vercel deje fuera rutas
 * multi-segmento que con `[...slug]` solo a veces no matchean. Ver `vercelExpressBridge.ts`.
 */
export const config = { maxDuration: 120 };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  await vercelExpressHandler(req, res);
}
