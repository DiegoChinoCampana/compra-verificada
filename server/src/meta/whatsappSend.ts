/**
 * Envío de mensajes por WhatsApp Cloud API (paso 6).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

const DEFAULT_GRAPH_VERSION = "v21.0";

export async function sendWhatsappTextMessage(to: string, body: string): Promise<void> {
  const token = (process.env.WHATSAPP_CLOUD_TOKEN ?? "").trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const graphVersion = (process.env.WHATSAPP_GRAPH_API_VERSION ?? DEFAULT_GRAPH_VERSION).replace(
    /^v?/,
    "v",
  );
  if (!token || !phoneNumberId) {
    console.warn(
      "[whatsapp] WHATSAPP_CLOUD_TOKEN o WHATSAPP_PHONE_NUMBER_ID sin configurar; no se envía mensaje.",
    );
    return;
  }
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("[whatsapp] send failed", res.status, t.slice(0, 500));
  }
}
