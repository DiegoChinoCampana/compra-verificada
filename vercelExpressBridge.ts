import type { VercelRequest, VercelResponse } from "@vercel/node";

type AppModule = typeof import("./server/dist/app.js");
type ExpressApp = AppModule["app"];

/**
 * Bridge entre handlers en `api/**` y Express (`server/dist/app.js`).
 * Vercel enruta mal algunas rutas multi-segmento si solo hay un catch-all en la raíz de `api/`;
 * los handlers `api/<segmento>/[...path].ts` delegan acá con `normalizeRequestUrl`.
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
 * Para el catch-all `api/[...slug].ts`: recompone `req.url` en la forma que espera Express
 * (prefijo `/api/...` y sin duplicados).
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

/**
 * Si Vercel entrega `req.url` relativo al prefijo del handler (p. ej. `/5/results` bajo
 * `api/articles/[...path].ts`), rearmamos la URL absoluta que espera Express.
 */
export function normalizeRequestUrl(req: VercelRequest, apiMount: string): void {
  const mount = apiMount.endsWith("/") ? apiMount.slice(0, -1) : apiMount;
  const u = req.url ?? "/";
  if (u.startsWith("?")) {
    req.url = `${mount}${u}`;
    syncOriginalUrl(req);
    return;
  }
  if (u === mount || u.startsWith(`${mount}/`) || u.startsWith(`${mount}?`)) {
    syncOriginalUrl(req);
    return;
  }
  if (u.startsWith("/")) {
    req.url = `${mount}${u}`;
  } else {
    req.url = `${mount}/${u}`;
  }
  syncOriginalUrl(req);
}

function syncOriginalUrl(req: VercelRequest): void {
  const extended = req as VercelRequest & { originalUrl?: string };
  if (typeof extended.originalUrl === "string") {
    extended.originalUrl = req.url ?? "/";
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

/** Ejecuta Express; el caller debe ajustar `req.url` antes (prepare o normalize). */
export async function vercelExpressHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
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
