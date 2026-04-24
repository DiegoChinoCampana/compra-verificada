import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  const routesInfo = {
    timestamp: new Date().toISOString(),
    mensaje: "Lista de rutas API disponibles (diagnóstico)",
    rutas_api: [
      { ruta: "/api/debug", descripcion: "Diagnóstico general" },
      { ruta: "/api/debug-env", descripcion: "Env sin Postgres (existente)" },
      { ruta: "/api/routes", descripcion: "Esta lista de rutas" },
      { ruta: "/api/test-db", descripcion: "Test Postgres (existente)" },
      { ruta: "/api/tableros/*", descripcion: "Debug catch-all tableros (solo diagnóstico)" },
      { ruta: "/api/informe/*", descripcion: "Debug catch-all informe (solo diagnóstico)" },
      { ruta: "/api/listados/*", descripcion: "Debug catch-all listados (solo diagnóstico)" },
      { ruta: "/api/articles/:id", descripcion: "Express — ficha artículo (handler dedicado)" },
      { ruta: "/api/articles/:id/results", descripcion: "Express — listados scrapeados" },
      { ruta: "/api/analytics/*", descripcion: "Express — tablero (analytics)" },
      { ruta: "/api/report/*", descripcion: "Express — informe" },
      { ruta: "/api/analysis/*", descripcion: "Express — análisis" },
      {
        ruta: "/api/[...slug]",
        descripcion: "Express: resto (/api/articles lista, /api/results, /api/health, …)",
      },
    ],
    rutas_spa_reales: {
      tablero: "/articulos/:id",
      listados: "/articulos/:id/listados",
      informe_ui: "/informe/:id",
      nota: "La app no usa /tableros ni /api/tableros en producción; los handlers /api/tableros son solo para probar el enrutado de Vercel.",
    },
    nota: "Las rutas del frontend (SPA) usan rewrites en vercel.json hacia /index.html",
    vercel_catch_all_query:
      "Express va solo por `api/[...slug].ts`; Vercel expone segmentos en req.query['...slug'] / ['...path'] / otras claves '...*'. El bridge las fusiona en req.url.",
  };

  res.status(200).json(routesInfo);
}
