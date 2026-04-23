import type { VercelRequest, VercelResponse } from "@vercel/node";
import serverless from "serverless-http";
import { app } from "../server/src/app.js";
import { ensureSchema } from "../server/src/db.js";

let cachedHandler: ReturnType<typeof serverless> | null = null;
let preparePromise: Promise<void> | null = null;

async function prepare(): Promise<void> {
  if (!preparePromise) {
    preparePromise = (async () => {
      if (process.env.SKIP_DB_SCHEMA !== "true" && process.env.SKIP_DB_SCHEMA !== "1") {
        await ensureSchema();
      }
    })();
  }
  await preparePromise;
  if (!cachedHandler) {
    cachedHandler = serverless(app);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await prepare();
    await cachedHandler!(req as never, res as never);
  } catch (e) {
    console.error("[api]", e);
    if (!res.headersSent) {
      res.status(500).json({
        error: "server_error",
        message: "Fallo al preparar o ejecutar la API (revisá logs en Vercel y DATABASE_URL / schema).",
      });
    }
  }
}
