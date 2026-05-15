import { fetchHotSaleTrendRowForArticle } from "./hotSaleRoundup.js";

const ALLOWED_DAYS = new Set([10, 30, 60]);

export type HotSaleResumenSnapshot = {
  days: number;
  lastRunAt: string;
  lastRunMinAny: number;
  /** Mínimo del primer día con dato en la ventana, entre todas las tiendas (mismo producto). */
  marketFirstMin: number;
  /** (último mínimo mercado − primer mínimo mercado) / primer mínimo mercado (mismo cálculo que la guía). */
  marketTrendPct: number;
  lastRunCheapestSeller: string | null;
  anchorSeller: string | null;
  anchorFirstMin: number;
  anchorMaxInWindow: number;
  /** Listado más barato en la última corrida: otra tienda que la ancla y por debajo del mínimo inicial de la ancla. */
  otherStoreBeatAnchor: boolean;
};

export async function fetchHotSaleResumenSnapshot(
  articleId: number,
  daysRaw: unknown,
): Promise<HotSaleResumenSnapshot | null> {
  const n = Number(daysRaw);
  if (!ALLOWED_DAYS.has(n) || !Number.isInteger(articleId) || articleId <= 0) return null;
  const days = n as 10 | 30 | 60;

  const t = await fetchHotSaleTrendRowForArticle(articleId, days);
  if (!t) return null;

  const lastRunMinAny = t.market_last_min;
  const anchorFirstMin = t.first_min;
  const marketFirstMin = t.market_first_min;
  const anchorMaxInWindow = t.w_max;
  const lastAt = t.market_last_at;
  const anchorStale = !t.anchor_fresh;

  if (
    !Number.isFinite(lastRunMinAny) ||
    lastRunMinAny <= 0 ||
    !Number.isFinite(marketFirstMin) ||
    marketFirstMin <= 0 ||
    !Number.isFinite(t.market_trend_pct) ||
    lastAt == null ||
    String(lastAt).trim() === ""
  ) {
    return null;
  }

  if (
    !anchorStale &&
    (!Number.isFinite(anchorFirstMin) ||
      anchorFirstMin == null ||
      anchorFirstMin <= 0 ||
      !Number.isFinite(anchorMaxInWindow) ||
      anchorMaxInWindow == null)
  ) {
    return null;
  }

  const marketTrendPct = t.market_trend_pct;

  const lastRunCheapestSeller = t.market_last_cheapest_seller;
  const anchorSeller = anchorStale ? null : t.trend_seller;

  const eps =
    anchorStale || anchorFirstMin == null ? 0 : Math.max(0.01, anchorFirstMin * 0.002);
  const loweredEnough =
    !anchorStale && anchorFirstMin != null && lastRunMinAny < anchorFirstMin - eps;
  const otherStore =
    !anchorStale &&
    anchorSeller != null &&
    lastRunCheapestSeller != null &&
    lastRunCheapestSeller !== anchorSeller;
  const otherStoreBeatAnchor = Boolean(loweredEnough && otherStore);

  return {
    days,
    lastRunAt: new Date(lastAt as string).toISOString(),
    lastRunMinAny,
    marketFirstMin,
    marketTrendPct,
    lastRunCheapestSeller,
    anchorSeller,
    anchorFirstMin: anchorStale || anchorFirstMin == null ? 0 : anchorFirstMin,
    anchorMaxInWindow: anchorStale || anchorMaxInWindow == null ? 0 : anchorMaxInWindow,
    otherStoreBeatAnchor,
  };
}
