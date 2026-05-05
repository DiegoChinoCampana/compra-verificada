import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.url,
      path: req.url?.split("?")[0],
      query: req.query,
      host: req.headers.host,
      userAgent: req.headers["user-agent"],
      referer: req.headers.referer ?? null,
    },
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_REGION: process.env.VERCEL_REGION,
      VERCEL_URL: process.env.VERCEL_URL,
    },
    database: {
      POSTGRES_CONFIGURED: Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim()),
    },
    proxy: {
      UPSTREAM_API_CONFIGURED: Boolean(process.env.CV_UPSTREAM_API?.trim()),
      SERVICE_TOKEN_CONFIGURED: Boolean(process.env.CV_SERVICE_TOKEN?.trim()),
    },
    status: "OK",
    mensaje: "API de debug funcionando correctamente",
  };

  console.log("========== DEBUG INFO ==========");
  console.log(JSON.stringify(debugInfo, null, 2));
  console.log("================================");

  res.status(200).json(debugInfo);
}
