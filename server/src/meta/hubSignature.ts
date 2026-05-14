import crypto from "node:crypto";
import type { Request } from "express";

/** Lee parámetros del challenge de verificación de Meta (`hub.mode`, etc.). */
export function readHubChallengeParams(req: Request): {
  mode: string | undefined;
  verifyToken: string | undefined;
  challenge: string | undefined;
} {
  const q = req.query as Record<string, string | string[] | undefined>;
  const pick = (key: string): string | undefined => {
    const v = q[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return undefined;
  };
  return {
    mode: pick("hub.mode"),
    verifyToken: pick("hub.verify_token"),
    challenge: pick("hub.challenge"),
  };
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` sobre el cuerpo crudo (JSON).
 * Requiere `META_APP_SECRET` (App Secret del panel de Meta).
 */
export function isValidMetaHubSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | string[] | undefined,
  appSecret: string,
): boolean {
  if (!rawBody?.length) return false;
  const v = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (typeof v !== "string" || !v.startsWith("sha256=")) return false;
  const gotHex = v.slice("sha256=".length);
  let gotBuf: Buffer;
  try {
    gotBuf = Buffer.from(gotHex, "hex");
  } catch {
    return false;
  }
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  if (gotBuf.length !== expected.length) return false;
  return crypto.timingSafeEqual(gotBuf, expected);
}
