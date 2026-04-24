import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Bridge compartido entre handlers en `api/**` y Express (`server/src/app.ts`).
 * Vercel puede no enrutar bien algunas rutas multi-segmento al solo `api/[...slug].ts`;
 * los handlers en `api/<segmento>/[...path].ts` delegan aquí.
 */
export type ExpressApp = Awaited<ReturnType<typeof import("./server/src/app.js")>>["app"];

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
        const { ensureSchema } = await import("./server/src/db.js");
        await ensureSchema();
      }
    })();
  }
  await preparePromise;
  if (!cachedApp) {
    const { app } = await import("./server/src/app.js");
    cachedApp = app;
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

/**
 * Si Vercel entrega `req.url` relativo al prefijo del handler, rearmamos la URL que espera Express.
 *
 * En handlers anidados (`api/articles/[...path].ts`, etc.) a veces llega solo `/articles/123` o
 * `/article/1/price-series`; anteponer `mount` tal cual produciría `/api/articles/articles/123` y
 * Express no matchea → 404 NOT_FOUND en el cliente.
 */
export function normalizeRequestUrl(req: VercelRequest, apiMount: string): void {
  const mount = apiMount.endsWith("/") ? apiMount.slice(0, -1) : apiMount;
  let u = req.url ?? "/";

  if (u.startsWith("http://") || u.startsWith("https://")) {
    try {
      const parsed = new URL(u);
      u = parsed.pathname + (parsed.search || "");
    } catch {
      /* seguir con u */
    }
  }

  if (u === mount || u.startsWith(`${mount}/`) || u.startsWith(`${mount}?`)) return;

  const parts = mount.split("/").filter(Boolean);
  const afterApi = parts.length >= 2 ? parts[1] : "";
  if (
    afterApi &&
    (u.startsWith(`/${afterApi}/`) || u === `/${afterApi}` || u.startsWith(`/${afterApi}?`))
  ) {
    req.url = `/api${u}`;
    return;
  }

  if (u.startsWith("/")) {
    req.url = `${mount}${u}`;
  } else {
    req.url = `${mount}/${u}`;
  }
}

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
