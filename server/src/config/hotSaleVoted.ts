/**
 * Slots de la Guía Hot Sale (Instagram + vínculo a fichas).
 *
 * **Origen de datos** (en este orden):
 * 1. Variable de entorno `HOT_SALE_VOTED_JSON`: array JSON (útil en dev / CI).
 * 2. Fila `configs` con `name = 'hot_sale_voted_slots'`: columna `value` = mismo JSON.
 *
 * Actualizar en producción:
 * ```sql
 * UPDATE configs SET value = '[...]'::text WHERE name = 'hot_sale_voted_slots';
 * ```
 *
 * Formato de cada elemento:
 * - `articleId`: número de ficha (opcional; prioridad sobre `match`).
 * - `match`: `{ article?, brand?, detail? }` — fragmentos ILIKE como el filtro Artículos. Si no hay
 *   fila con todos los fragmentos, el backend prueba criterios más laxos (sin detalle, solo marca, etc.).
 */
import { pool } from "../db.js";

export type HotSaleArticleMatch = {
  article?: string;
  brand?: string;
  detail?: string;
};

export type HotSaleVotedSlot = {
  pollLabel: string;
  instagramLabel: string;
  articleId: number | null;
  match?: HotSaleArticleMatch;
};

const CONFIG_NAME = "hot_sale_voted_slots";

/** Parsea JSON de slots; entradas inválidas se omiten. Errores de sintaxis → []. */
export function parseHotSaleVotedSlotsJson(raw: string): HotSaleVotedSlot[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const out: HotSaleVotedSlot[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const pollLabel = typeof o.pollLabel === "string" ? o.pollLabel : "";
    const instagramLabel = typeof o.instagramLabel === "string" ? o.instagramLabel : "";
    if (!pollLabel.trim() && !instagramLabel.trim()) continue;

    let articleId: number | null = null;
    if (o.articleId != null && o.articleId !== "") {
      const n = Number(o.articleId);
      if (Number.isInteger(n) && n > 0) articleId = n;
    }

    let match: HotSaleArticleMatch | undefined;
    if (o.match && typeof o.match === "object") {
      const m = o.match as Record<string, unknown>;
      const article = typeof m.article === "string" ? m.article : undefined;
      const brand = typeof m.brand === "string" ? m.brand : undefined;
      const detail = typeof m.detail === "string" ? m.detail : undefined;
      if ((article ?? "").trim() || (brand ?? "").trim() || (detail ?? "").trim()) {
        match = { article, brand, detail };
      }
    }

    out.push({ pollLabel, instagramLabel, articleId, match });
  }
  return out;
}

export async function loadHotSaleVotedSlots(): Promise<HotSaleVotedSlot[]> {
  const env = process.env.HOT_SALE_VOTED_JSON?.trim();
  if (env) {
    const slots = parseHotSaleVotedSlotsJson(env);
    if (env.length > 0 && slots.length === 0) {
      console.warn("[hotSale] HOT_SALE_VOTED_JSON no es un array JSON válido de slots");
    }
    return slots;
  }

  const { rows } = await pool.query<{ value: string | null }>(
    `SELECT value FROM configs WHERE name = $1 ORDER BY id DESC LIMIT 1`,
    [CONFIG_NAME],
  );
  const raw = rows[0]?.value?.trim();
  if (!raw) return [];

  const slots = parseHotSaleVotedSlotsJson(raw);
  if (slots.length === 0 && raw.length > 0) {
    console.warn("[hotSale] configs.%s: JSON inválido o vacío tras parsear", CONFIG_NAME);
  }
  return slots;
}
