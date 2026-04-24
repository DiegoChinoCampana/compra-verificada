import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel empaqueta este handler en CommonJS; el servidor es ESM (type: module / "NodeNext").
 * Los `import()` dinámicos evitan ERR_REQUIRE_ESM al cargar `server/src/*.js`.
 *
 * No usar `serverless-http` con `(req, res)` de Vercel: trata el request como evento AWS,
 * fuerza `path` a `/` y Express no matchea `/api/*` → la respuesta nunca termina (timeout 120s en el cliente).
 */
type ExpressApp = Awaited<ReturnType<typeof import("../server/src/app.js")>>["app"];

let cachedApp: ExpressApp | null = null;
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
  if (!cachedApp) {
    const { app } = await import("../server/src/app.js");
    cachedApp = app;
  }
}

function runExpress(
  app: ExpressApp,
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      res.removeListener("finish", onFinish);
      res.removeListener("error", onError);
    }
    res.once("finish", onFinish);
    res.once("error", onError);
    try {
      app(req as never, res as never);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await prepare();
    await runExpress(cachedApp!, req, res);
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
