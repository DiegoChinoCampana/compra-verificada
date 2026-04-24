/**
 * Vercel “Express sin configuración”: una sola función con la URL real del cliente.
 * Ver https://vercel.com/docs/frameworks/backend/express
 *
 * Los catch-all bajo `api/[...].ts` + `outputDirectory` del SPA suelen devolver NOT_FOUND en rutas
 * profundas (`/api/articles/1/results`, `/api/analytics/article/1/price-series`, etc.).
 */
import { app } from "../server/dist/app.js";

export default app;
