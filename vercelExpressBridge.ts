import type { VercelRequest, VercelResponse } from "@vercel/node";

type AppModule = typeof import("./server/dist/app.js");
type ExpressApp = AppModule["app"];

/**
 * Bridge entre handlers en `api/**` y Express (`server/dist/app.js`).
 * Vercel a veces deja los segmentos del catch-all en `req.query` (`path`, `slug`) y `req.url`
 * incompleto; Express no matchea `/api/...` y la plataforma responde NOT_FOUND en HTML.
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

function queryParamJoined(
  q: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const v = q[key];
  if (v === undefined) return null;
  const parts = Array.isArray(v) ? v : [v];
  const joined = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join("/");
  return joined.length ? joined : null;
}

/**
 * Recompone `/api/...` desde `req.query.path` / `req.query.slug` (catch-all de Vercel).
 */
function mergeVercelCatchAllParam(req: VercelRequest, key: string, mountPrefix: string): void {
  const mount = mountPrefix.endsWith("/") ? mountPrefix.slice(0, -1) : mountPrefix;
  const q = req.query as Record<string, string | string[] | undefined>;
  const joined = queryParamJoined(q, key);
  if (!joined) return;

  const fullPath = mount === "/api" ? `/api/${joined}` : `${mount}/${joined}`;
  const url = req.url ?? "/";
  const { path: pathOnly } = pathnameAndSearch(url);

  if (
    pathOnly === fullPath ||
    pathOnly.startsWith(`${fullPath}/`) ||
    pathOnly.startsWith(`${fullPath}?`)
  ) {
    return;
  }

  const { search: searchFromUrl } = pathnameAndSearch(url);
  const sp = new URLSearchParams(
    searchFromUrl.startsWith("?") ? searchFromUrl.slice(1) : "",
  );
  for (const [qk, val] of Object.entries(q)) {
    if (qk === key) continue;
    if (typeof val === "string") sp.append(qk, val);
    else if (Array.isArray(val)) {
      for (const item of val) {
        if (item != null && item !== "") sp.append(qk, String(item));
      }
    }
  }
  const search = sp.toString() ? `?${sp.toString()}` : "";
  req.url = fullPath + search;
  try {
    delete (q as Record<string, unknown>)[key];
  } catch {
    /* query puede ser de solo lectura */
  }
  syncOriginalUrl(req);
}

/**
 * Para el catch-all `api/[...slug].ts`: recompone `req.url` en la forma que espera Express.
 */
export function prepareExpressRequestUrl(req: VercelRequest): void {
  mergeVercelCatchAllParam(req, "slug", "/api");

  const raw = req.url ?? "/";
  let { path, search } = pathnameAndSearch(raw);
  if (path === "") path = "/";

  if (!path.startsWith("/api")) {
    path = "/api" + (path.startsWith("/") ? path : `/${path}`);
  }

  path = dedupeApiPath(path);
  const fixed = path + search;
  req.url = fixed;
  syncOriginalUrl(req);
}

/**
 * Handlers `api/<segmento>/[...path].ts`: prefijo + resto; también fusiona `req.query.path`.
 */
export function normalizeRequestUrl(req: VercelRequest, apiMount: string): void {
  mergeVercelCatchAllParam(req, "path", apiMount);

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
  extended.originalUrl = req.url ?? "/";
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
