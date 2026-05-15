export type Article = {
  id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  enabled: boolean;
  created_at: string;
  last_scraped_at: string | null;
  ordered_by?: string;
  official_store_required?: boolean | null;
  free_shipping_required?: boolean | null;
};

export type PriceSeriesRow = {
  scrape_run_id: number;
  executed_at: string;
  min_price: number;
  avg_price: number;
  listing_count: number;
};

export type DispersionRow = {
  scrape_run_id: number;
  executed_at: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  stddev_pop: number | null;
  listing_count: number;
  coefficient_of_variation?: number | null;
};

export type CriteriaRow = {
  total_results: number;
  required_official_count: number;
  official_met_count: number;
  required_free_ship_count: number;
  free_ship_met_count: number;
};

export type PeerRow = {
  id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  enabled: boolean;
  latest_run_min_price: number | null;
  latest_run_at: string | null;
};

/** Fila de `results` + fecha de la corrida (listado completo por artículo). */
export type ArticleResultRow = {
  id: number;
  scrape_run_id: number;
  run_executed_at: string;
  title: string | null;
  price: number | null;
  rating: number | null;
  url: string | null;
  seller: string | null;
  seller_score: string | null;
  created_at: string;
  scrape_run_criteria: string | null;
  official_store_required: boolean | null;
  official_store_applied: boolean | null;
  free_shipping_required: boolean | null;
  free_shipping_applied: boolean | null;
  /** Clave de producto semántico (batch); null si aún no hubo clustering para esa fila. */
  product_key: string | null;
  product_cluster_id: number | null;
  product_confidence: number | null;
};

export type ArticleResultsPagePayload = {
  total: number;
  limit: number;
  page: number;
  offset: number;
  rows: ArticleResultRow[];
};

export type Recommendation = {
  label: string;
  tone: "positive" | "neutral" | "negative";
  score: number;
  factors: { key: string; impact: "up" | "down" | "flat"; detail: string }[];
};

/** Cómo se acotan gráficos / informe al “mismo producto” por título. */
export type AnalyticsScopePayload = {
  hasCanonicalProduct: boolean;
  scopeMode?: "auto" | "manual" | "key";
  canonicalNormTitle: string | null;
  displayTitle: string | null;
  sellerFilter?: string | null;
};

export type ScrapedResultListRow = {
  result_id: number;
  article_id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  title: string | null;
  seller: string | null;
  price: number | null;
  rating: number | null;
  url: string | null;
  created_at: string;
  scrape_run_id: number;
  run_executed_at: string;
  product_key: string | null;
  product_cluster_id: number | null;
  product_confidence: number | null;
};

/** Respuesta de `/api/analytics/operational/product-clustering-meta`. */
export type ProductClusteringMetaPayload = {
  /** Si hay que enviar `secret` en el POST (Vercel o servidor con `CLUSTER_BATCH_SECRET`). */
  requiresClusterBatchSecret?: boolean;
  /** Si el proceso de API ve `OPENAI_API_KEY` (embeddings). */
  openAiConfigured?: boolean;
  /** `false` = no existe `result_embeddings` (falta extensión `vector` / esquema). Ausente = API vieja. */
  embeddingsTableReady?: boolean;
  lastRun: {
    finishedAt: string;
    article: string;
    days: number;
    embedded: number;
    clusteredRows: number;
    inCluster: number;
    noise: number;
    minSimilarity: number;
    minPts: number;
    centroidMergeMinSimilarity?: number;
    skipCentroidMerge?: boolean;
    pairwiseMergeMinSimilarity?: number;
    skipPairwiseMerge?: boolean;
    titleAnchorMinLen?: number;
    skipTitleAnchorMerge?: boolean;
    resetArticleWindow?: boolean;
    resetScope: boolean;
    durationMs: number;
  } | null;
  counts: {
    with_product_key: number;
    with_embedding: number;
    total_results: number;
  } | null;
  countsError?: string;
};

/** Respuesta de `POST /api/analytics/operational/product-clustering-run`. */
export type ProductClusteringRunResponse =
  | { ok: true; result: NonNullable<ProductClusteringMetaPayload["lastRun"]> }
  | { ok: false; error: string };

export type ScrapedResultsPagePayload = {
  total: number;
  limit: number;
  page: number;
  offset: number;
  rows: ScrapedResultListRow[];
};

/** Fila de /api/analysis/price-stability-by-name (agrupa por `product_key` o título normalizado + tienda). */
export type PriceStabilityRow = {
  series_id: number;
  product_title: string;
  /** Título de publicación ML más reciente en el grupo (siempre útil para lectura humana). */
  sample_listing_title: string;
  /** Misma clave de agrupación que en servidor (`sqlProductGroupingKey`). */
  group_key: string;
  /** Tienda/vendedor normalizado (`results.seller`); sin dato → "(sin tienda)". */
  seller: string;
  n_articles: number;
  primary_article_id: number;
  n_days: number;
  first_day_min: number;
  last_day_min: number;
  trend_pct: number | null;
  range_pct: number | null;
  cv_daily_mins: number | null;
};

/** Un día de mínimo scrapeado (misma ventana y criterio de corrida que la tabla). */
export type PriceStabilityDailyPoint = {
  day: string;
  min_price: number;
};

/** Serie diaria alineada con cada fila (mismo `series_id`). */
export type PriceStabilityDailySeries = {
  series_id: number;
  product_title: string;
  sample_listing_title: string;
  points: PriceStabilityDailyPoint[];
};

export type PriceStabilityByNamePayload = {
  name: string;
  days: number;
  count: number;
  rows: PriceStabilityRow[];
  daily_by_series: PriceStabilityDailySeries[];
};

/** Fila de /api/analysis/peer-gap-by-name */
export type PeerGapRow = {
  id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  /** Clave del listado más barato en la última corrida (product_key o título normalizado). */
  ref_group_key: string;
  my_ref_min: number;
  peer_median: number | null;
  gap_vs_peer_median_pct: number | null;
};

export type PeerGapByNamePayload = {
  name: string;
  count: number;
  rows: PeerGapRow[];
};

/** Fila de /api/analysis/price-jumps-by-name */
export type PriceJumpRow = {
  product_title: string;
  sample_listing_title: string;
  group_key: string;
  /** Tienda/vendedor normalizado; la serie del salto es por producto + esta tienda. */
  seller: string;
  n_articles: number;
  primary_article_id: number;
  day_from: string;
  day_to: string;
  max_jump_pct: number;
};

export type PriceJumpsByNamePayload = {
  name: string;
  days: number;
  threshold_pct: number;
  count: number;
  rows: PriceJumpRow[];
};

export type HotSaleResumenPayload = {
  days: number;
  lastRunAt: string;
  lastRunMinAny: number;
  /** Desde backend reciente; si falta, no mostramos línea de tendencia. */
  marketFirstMin?: number;
  marketTrendPct?: number;
  lastRunCheapestSeller: string | null;
  anchorSeller: string | null;
  anchorFirstMin: number;
  anchorMaxInWindow: number;
  otherStoreBeatAnchor: boolean;
};

export type ReportPayload = {
  generatedAt: string;
  article: Article;
  disclaimer: string;
  analyticsScope?: AnalyticsScopePayload;
  /** Si la URL incluye `hotSaleDays` y hay datos suficientes, el backend lo rellena. */
  hotSaleResumen?: HotSaleResumenPayload | null;
  sections: {
    priceSeries: PriceSeriesRow[];
    bestOfferPerRun: Record<string, unknown>[];
    dispersionPerRun: DispersionRow[];
    sellers: Record<string, unknown>[];
    criteriaCompliance: CriteriaRow;
    peerComparisonByBrand: PeerRow[];
  };
  recommendation: Recommendation;
};

/** GET /api/report/hot-sale-roundup */
export type HotSaleNarrativeFlags = {
  possibleInflatedAnchor: boolean;
  lastBelowWindowMedian: boolean;
  lastAboveWindowMedian: boolean;
  sharpDayDrop: boolean;
};

export type HotSaleNarrativePayload = {
  bullets: string[];
  flags: HotSaleNarrativeFlags;
};

export type HotSaleVotedRoundupRow = {
  pollLabel: string;
  instagramLabel: string;
  articleId: number | null;
  resolvedByMatch: boolean;
  /** Ficha asignada con criterio ampliado (no coincidía el producto exacto del voto). Ausente en APIs viejas. */
  approximateMatch?: boolean;
  linked: boolean;
  article: string | null;
  brand: string | null;
  detail: string | null;
  first_min: number | null;
  last_min: number | null;
  trend_pct: number | null;
  n_points: number | null;
  w_min: number | null;
  w_max: number | null;
  w_median: number | null;
  max_dod_drop_pct: number | null;
  /** Tienda ancla: misma lógica que topPriceDrops (vendedor del listado más barato del primer día en el clúster). */
  trend_seller?: string | null;
  /**
   * false si la tienda ancla no tiene precios del mismo producto en los últimos 7 días vs el último día mercado.
   * Ausente = API vieja (asumir ancla vigente si hay trend_pct).
   */
  anchor_fresh?: boolean | null;
  /** Origen de la ancla en el backend: first_day_cheapest | first_day_alt | last_run_cheapest. */
  anchor_source?: string | null;
  anchor_first_day_rank?: number | null;
  market_first_min?: number | null;
  market_last_min?: number | null;
  market_trend_pct?: number | null;
  market_n_points?: number | null;
  market_w_min?: number | null;
  market_w_max?: number | null;
  market_w_median?: number | null;
  market_max_dod_drop_pct?: number | null;
  narrative: HotSaleNarrativePayload | null;
};

export type HotSalePriceDropRow = {
  article_id: number;
  article: string;
  brand: string | null;
  detail: string | null;
  /** false = tienda ancla sin datos recientes; esta fila no debería aparecer en top caídas (filtro servidor). */
  anchor_fresh?: boolean;
  anchor_source?: string | null;
  anchor_first_day_rank?: number | null;
  first_min: number;
  last_min: number;
  trend_pct: number;
  n_points: number;
  w_min: number;
  w_max: number;
  w_median: number;
  max_dod_drop_pct: number;
  trend_seller?: string | null;
  market_first_min?: number | null;
  market_last_min?: number | null;
  market_trend_pct?: number | null;
  market_n_points?: number | null;
  market_w_min?: number | null;
  market_w_max?: number | null;
  market_w_median?: number | null;
  market_max_dod_drop_pct?: number | null;
  narrative: HotSaleNarrativePayload;
};

export type HotSaleRoundupPayload = {
  generatedAt: string;
  days: number;
  disclaimer: string;
  voted: HotSaleVotedRoundupRow[];
  topPriceDrops: HotSalePriceDropRow[];
};
