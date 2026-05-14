import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Proxy delgado opcional Vercel(Node) → Tomcat(Spring).
 *
 * Diseño:
 * - Si `CV_UPSTREAM_API` NO está seteada (o vacía), este middleware llama `next()` y
 *   todo sigue como hoy: las rutas de `app.ts` ejecutan SQL contra Postgres.
 * - Si `CV_UPSTREAM_API` está seteada (p. ej. `https://tomcat.tu-dominio:8080`), el
 *   middleware reenvía cada request a `${CV_UPSTREAM_API}${req.url}` y devuelve la
 *   respuesta tal cual. Las rutas de `app.ts` no llegan a ejecutarse, así que la base
 *   remota deja de tener tráfico desde Vercel y se puede firewallear para aceptar
 *   conexiones únicamente desde el host del Tomcat.
 *
 * Headers que se reenvían:
 * - `Content-Type: application/json` siempre (el body parseado se re-stringifica).
 * - `Authorization` del cliente, salvo que `CV_SERVICE_TOKEN` esté configurada: en ese
 *   caso la inyectamos como `Bearer <token>` (token compartido Node↔Spring).
 * - `X-Cluster-Batch-Secret` del cliente (necesario para el POST de clustering).
 */
export function isProxyMode(): boolean {
  return Boolean(process.env.CV_UPSTREAM_API?.trim());
}

function upstreamBaseUrl(): string {
  return (process.env.CV_UPSTREAM_API ?? "").trim().replace(/\/+$/, "");
}

function pickHeader(req: Request, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" ? v : null;
}

/** ms; fetch al upstream tiene que cortar antes del `maxDuration` de la función Vercel. */
const UPSTREAM_TIMEOUT_MS = Number(process.env.CV_UPSTREAM_TIMEOUT_MS ?? 25_000);

export function buildProxyMiddleware(): RequestHandler {
  return async function proxyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!isProxyMode()) {
      next();
      return;
    }

    /** WhatsApp / Meta webhook y futuras rutas `/api/meta/*` viven siempre en Node. */
    if ((req.url ?? "").startsWith("/api/meta")) {
      next();
      return;
    }

    const target = upstreamBaseUrl() + (req.url ?? "/");

    /** Headers que mandamos al Tomcat. */
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const xcs = pickHeader(req, "x-cluster-batch-secret");
    if (xcs) headers["X-Cluster-Batch-Secret"] = xcs;

    const serviceToken = (process.env.CV_SERVICE_TOKEN ?? "").trim();
    if (serviceToken) {
      headers["Authorization"] = `Bearer ${serviceToken}`;
    } else {
      const clientAuth = pickHeader(req, "authorization");
      if (clientAuth) headers["Authorization"] = clientAuth;
    }

    const init: RequestInit = {
      method: req.method ?? "GET",
      headers,
    };

    /** Solo mandamos body en métodos que lo soportan. `req.body` viene parseado por express.json(). */
    if (
      req.method &&
      req.method.toUpperCase() !== "GET" &&
      req.method.toUpperCase() !== "HEAD" &&
      req.body !== undefined &&
      req.body !== null
    ) {
      init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    init.signal = ctrl.signal;

    try {
      const upstreamRes = await fetch(target, init);
      const text = await upstreamRes.text();
      const ct = upstreamRes.headers.get("content-type");
      if (ct) res.setHeader("Content-Type", ct);
      res.status(upstreamRes.status).send(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[proxy] upstream error", { target, message });
      if (!res.headersSent) {
        res.status(502).json({
          error: "upstream_error",
          message: `No se pudo contactar al backend Spring (${target}): ${message}`,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
