import type { Request } from "express";

/** Bearer igual a `CV_SERVICE_TOKEN` (mismo esquema que proxy Node↔Spring). */
export function isAuthorizedServiceRequest(req: Request): boolean {
  const token = (process.env.CV_SERVICE_TOKEN ?? "").trim();
  if (!token) return false;
  const h = req.headers.authorization;
  if (typeof h !== "string" || !h.startsWith("Bearer ")) return false;
  return h.slice("Bearer ".length).trim() === token;
}
