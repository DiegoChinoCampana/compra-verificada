import type { VercelRequest, VercelResponse } from "@vercel/node";
import serverless from "serverless-http";

/**
 * Vercel empaqueta este handler en CommonJS; el servidor es ESM (type: module / "NodeNext").
 * Los `import()` dinámicos evitan ERR_REQUIRE_ESM al cargar `server/src/*.js`.
 */
let cachedHandler: ReturnType<typeof serverless> | null = null;
let preparePromise: Promise<void> | null = null;

async function prepare(): Promise<void> {
  if (!preparePromise) {
    preparePromise = (async () => {
      console.log(
        "[api] prepare",
        JSON.stringify({
          vercel: Boolean(process.env.VERCEL),
          hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
          hasDbHost: Boolean(process.env.DB_HOST?.trim()),
          skipSchema: process.env.SKIP_DB_SCHEMA === "true" || process.env.SKIP_DB_SCHEMA === "1",
        }),
      );
      if (process.env.SKIP_DB_SCHEMA !== "true" && process.env.SKIP_DB_SCHEMA !== "1") {
        const { ensureSchema } = await import("../server/src/db.js");
        await ensureSchema();
      }
    })();
  }
  await preparePromise;
  if (!cachedHandler) {
    const { app } = await import("../server/src/app.js");
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
