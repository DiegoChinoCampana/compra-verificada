import type { Pool } from "pg";
import { RUNS_ONE_PER_DAY_CTE } from "../sql/runsOnePerDay.js";

export type PriceSeriesRow = {
  executed_at: Date;
  min_price: number;
  avg_price: number;
  listing_count: number;
};

/** Serie “auto” (sin alcance manual / productKey), una corrida por día, últimos `days`. */
export async function fetchPriceSeriesLastDays(
  pool: Pool,
  articleId: number,
  days: number,
): Promise<PriceSeriesRow[]> {
  const sql = `
    WITH
    ${RUNS_ONE_PER_DAY_CTE.trim()}
    SELECT
      sr.executed_at,
      MIN(r.price)::float8 AS min_price,
      AVG(r.price)::float8 AS avg_price,
      COUNT(*)::int AS listing_count
    FROM results r
    JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
    WHERE r.search_id = $1
      AND r.price IS NOT NULL
      AND sr.executed_at >= NOW() - ($2::int * INTERVAL '1 day')
    GROUP BY sr.id, sr.executed_at
    ORDER BY sr.executed_at ASC
  `;
  const { rows } = await pool.query(sql, [articleId, days]);
  return rows as PriceSeriesRow[];
}

export function formatPriceSeriesForWhatsapp(
  rows: PriceSeriesRow[],
  days: number,
  draft: { article: string; brand: string; detail: string },
  userNote?: string,
): string {
  const head = `*${draft.article}* · ${draft.brand || "—"} · ${draft.detail || "—"}\nÚltimos ${days} días (Mercado Libre, según nuestros relevamientos):\n`;
  if (!rows.length) {
    return (
      head +
      "\nNo hay historial reciente en la base para esta combinación. Si acabás de dar de alta el producto, puede tardar en aparecer datos."
    );
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const minAll = Math.min(...rows.map((r) => r.min_price));
  const maxAll = Math.max(...rows.map((r) => r.min_price));
  const ars = (n: number) =>
    n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const d0 = new Date(first.executed_at).toLocaleDateString("es-AR");
  const d1 = new Date(last.executed_at).toLocaleDateString("es-AR");
  let t =
    head +
    `\n• Primer día del período (${d0}): precio mínimo relevado ${ars(first.min_price)}.\n` +
    `• Último día (${d1}): mínimo ${ars(last.min_price)}.\n` +
    `• Rango de mínimos día a día: ${ars(minAll)} – ${ars(maxAll)}.\n` +
    `• Puntos en la serie: ${rows.length} (una corrida por día calendario con datos).`;
  if (userNote?.trim()) {
    t += `\n\n(Dato que compartiste: ${userNote.trim()})`;
  }
  return t;
}
