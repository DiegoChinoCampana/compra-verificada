import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const pathSegments = req.query.path;

  const debugInfo = {
    timestamp: new Date().toISOString(),
    ruta: "informe",
    request: {
      method: req.method,
      fullUrl: req.url,
      pathSegments,
      query: req.query,
    },
    status: "OK",
    mensaje: "La ruta /api/informe está respondiendo correctamente",
  };

  console.log("========== INFORME DEBUG ==========");
  console.log(JSON.stringify(debugInfo, null, 2));
  console.log("===================================");

  res.status(200).json(debugInfo);
}
