import crypto from "node:crypto";
import type { Request } from "express";

function pickQueryString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const first = v[0];
    if (typeof first === "string") return first;
  }
  return undefined;
}

/**
 * Meta envía `GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.
 * Express/`qs` suele dejar claves planas `hub.mode`, pero en algunos setups
 * aparece un objeto anidado `hub[mode]` → soportamos ambos y un fallback desde la URL.
 */
export function readHubChallengeParams(req: Request): {
  mode: string | undefined;
  verifyToken: string | undefined;
  challenge: string | undefined;
} {
  const q = req.query as Record<string, unknown>;

  const fromNestedHub = (): {
    mode: string | undefined;
    verifyToken: string | undefined;
    challenge: string | undefined;
  } => {
    const hub = q.hub;
    if (!hub || typeof hub !== "object" || Array.isArray(hub)) {
      return { mode: undefined, verifyToken: undefined, challenge: undefined };
    }
    const h = hub as Record<string, unknown>;
    return {
      mode: pickQueryString(h.mode),
      verifyToken: pickQueryString(h.verify_token),
      challenge: pickQueryString(h.challenge),
    };
  };

  const fromFlat = () => ({
    mode: pickQueryString(q["hub.mode"]),
    verifyToken: pickQueryString(q["hub.verify_token"]),
    challenge: pickQueryString(q["hub.challenge"]),
  });

  const fromUrl = (): {
    mode: string | undefined;
    verifyToken: string | undefined;
    challenge: string | undefined;
  } => {
    try {
      const raw = (req.originalUrl ?? req.url ?? "").split("?")[1];
      if (!raw) return { mode: undefined, verifyToken: undefined, challenge: undefined };
      const sp = new URLSearchParams(raw);
      return {
        mode: sp.get("hub.mode") ?? undefined,
        verifyToken: sp.get("hub.verify_token") ?? undefined,
        challenge: sp.get("hub.challenge") ?? undefined,
      };
    } catch {
      return { mode: undefined, verifyToken: undefined, challenge: undefined };
    }
  };

  const flat = fromFlat();
  if (flat.mode || flat.verifyToken || flat.challenge) {
    return flat;
  }
  const nested = fromNestedHub();
  if (nested.mode || nested.verifyToken || nested.challenge) {
    return nested;
  }
  return fromUrl();
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
