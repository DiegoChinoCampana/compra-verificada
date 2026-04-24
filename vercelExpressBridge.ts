import type { VercelRequest, VercelResponse } from "@vercel/node";

type AppModule = typeof import("./server/dist/app.js");
type ExpressApp = AppModule["app"];

/**
 * Bridge entre `api/[[...slug]].ts` y Express (`server/src/app.ts`).
 * En Vercel, `req.url` a veces llega sin el prefijo `/api` (p. ej. `/articles/5` o
 * `/analytics/article/1/price-series`), y Express solo registra rutas bajo `/api/...` → NOT_FOUND.
 */
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
        const { ensureSchema } = await import("./server/dist/db.js");
        await ensureSchema();
      }
    })();
  }
  await preparePromise;
  if (!cachedApp) {
    const { app } = await import("./server/dist/app.js");
    cachedApp = app;
  }
}

function pathnameAndSearch(raw: string): { path: string; search: string } {
  let s = raw;
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const parsed = new URL(s);
      return { path: parsed.pathname || "/", search: parsed.search || "" };
    } catch {
      /* seguir */
    }
  }
  const qIdx = s.indexOf("?");
  if (qIdx === -1) return { path: s || "/", search: "" };
  return { path: s.slice(0, qIdx) || "/", search: s.slice(qIdx) };
}

/** Corrige duplicados si antes se antepuso mal el prefijo. */
function dedupeApiPath(path: string): string {
  return path
    .replace(/^\/api\/articles\/articles(?=\/|\?|$)/, "/api/articles")
    .replace(/^\/api\/analytics\/analytics(?=\/|\?|$)/, "/api/analytics")
    .replace(/^\/api\/analysis\/analysis(?=\/|\?|$)/, "/api/analysis")
    .replace(/^\/api\/report\/report(?=\/|\?|$)/, "/api/report");
}

/**
 * Deja `req.url` (y `originalUrl` si existe) en la forma que espera el router de Express.
 */
export function prepareExpressRequestUrl(req: VercelRequest): void {
  const raw = req.url ?? "/";
  let { path, search } = pathnameAndSearch(raw);
  if (path === "") path = "/";

  if (!path.startsWith("/api")) {
    path = "/api" + (path.startsWith("/") ? path : `/${path}`);
  }

  path = dedupeApiPath(path);
  const fixed = path + search;
  req.url = fixed;

  const extended = req as VercelRequest & { originalUrl?: string };
  if (typeof extended.originalUrl === "string") {
    extended.originalUrl = fixed;
  }
}

export function runExpress(
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

export async function vercelExpressHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    prepareExpressRequestUrl(req);
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
