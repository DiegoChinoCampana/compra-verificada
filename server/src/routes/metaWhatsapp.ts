import { type Request, type Response, Router } from "express";
import {
  isValidMetaHubSignature,
  readHubChallengeParams,
} from "../meta/hubSignature.js";
import { sendWhatsappTextMessage } from "../meta/whatsappSend.js";
import { handleInboundText } from "../whatsapp/botEngine.js";

export const metaWhatsappWebhookRouter = Router();

function handleWebhookVerification(req: Request, res: Response): void {
  const verifyToken = (process.env.META_WHATSAPP_VERIFY_TOKEN ?? "").trim();
  if (!verifyToken) {
    console.error("[whatsapp] GET verify: META_WHATSAPP_VERIFY_TOKEN vacío en el servidor");
    res.status(503).type("text/plain").send("META_WHATSAPP_VERIFY_TOKEN no configurado");
    return;
  }
  const { mode, verifyToken: sent, challenge } = readHubChallengeParams(req);
  const sentTrim = sent?.trim() ?? "";
  if (mode === "subscribe" && sentTrim === verifyToken && challenge !== undefined && challenge !== "") {
    /** Meta exige el challenge en texto plano, sin JSON ni comillas. */
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  console.warn("[whatsapp] GET verify falló", {
    mode: mode ?? null,
    tokenCoincide: sentTrim === verifyToken,
    tieneChallenge: Boolean(challenge),
  });
  res.status(403).type("text/plain").send("Forbidden");
}

metaWhatsappWebhookRouter.get(["/", ""], handleWebhookVerification);

metaWhatsappWebhookRouter.post("/", async (req: Request, res: Response) => {
  const secret = (process.env.META_APP_SECRET ?? "").trim();
  const sig = req.headers["x-hub-signature-256"];
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!secret) {
    const strict =
      process.env.VERCEL === "1" ||
      process.env.NODE_ENV === "production" ||
      (process.env.META_WEBHOOK_REQUIRE_SIGNATURE ?? "").trim() === "1";
    if (strict) {
      res.status(503).json({ error: "META_APP_SECRET requerido en este entorno" });
      return;
    }
    console.warn("[whatsapp] META_APP_SECRET sin definir: no se valida firma (solo desarrollo local).");
  } else if (!isValidMetaHubSignature(raw, sig, secret)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const messages = extractInboundMessages(req.body);
  for (const m of messages) {
    try {
      const replies = await handleInboundText(m.from, m.text);
      for (const r of replies) {
        await sendWhatsappTextMessage(m.from, r);
      }
    } catch (e) {
      console.error("[whatsapp] handle message", e);
    }
  }
  res.status(200).json({ ok: true });
});

function extractInboundMessages(body: unknown): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  if (!body || typeof body !== "object") return out;
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return out;
  for (const ent of entries) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const value = (ch as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const msgs = (value as { messages?: unknown }).messages;
      if (!Array.isArray(msgs)) continue;
      for (const msg of msgs) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as { type?: string; from?: string; text?: { body?: string } };
        if (m.type === "text" && m.from && m.text?.body) {
          out.push({ from: m.from, text: m.text.body });
        }
      }
    }
  }
  return out;
}
