/**
 * Estado de conversación por usuario de WhatsApp (en memoria).
 * En producción con varias instancias conviene Redis u otra tienda compartida.
 */

export type WaFlow = "menu" | "follow" | "consult";

export type WaSession = {
  updatedAt: number;
  flow: WaFlow;
  /** choose_article | choose_brand | choose_detail | consult_price_note | done */
  step: string;
  draft: {
    article: string;
    brand: string;
    detail: string;
  };
  lastOptions: string[];
};

const store = new Map<string, WaSession>();
const TTL_MS = 24 * 60 * 60 * 1000;

function prune(): void {
  const now = Date.now();
  if (store.size < 2000) return;
  for (const [k, s] of store) {
    if (now - s.updatedAt > TTL_MS) store.delete(k);
  }
}

export function getSession(waId: string): WaSession | null {
  const s = store.get(waId);
  if (!s) return null;
  if (Date.now() - s.updatedAt > TTL_MS) {
    store.delete(waId);
    return null;
  }
  return s;
}

export function setSession(waId: string, session: WaSession): void {
  prune();
  store.set(waId, { ...session, updatedAt: Date.now() });
}

export function resetSession(waId: string): void {
  store.delete(waId);
}

export function newMenuSession(): WaSession {
  return {
    updatedAt: Date.now(),
    flow: "menu",
    step: "menu",
    draft: { article: "", brand: "", detail: "" },
    lastOptions: [],
  };
}
