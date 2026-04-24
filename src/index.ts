/**
 * Vercel “Express sin configuración”: una sola función con la URL real del cliente.
 * Ver https://vercel.com/docs/frameworks/backend/express
 *
 * `vercel.json` → `functions` solo admite patrones bajo `api/`; maxDuration va aquí.
 */
import { app } from "../server/dist/app.js";

/** https://vercel.com/docs/functions/configuring-functions/duration */
export const maxDuration = 120;

export default app;
