export type RecommendationTone = "positive" | "neutral" | "negative";

export type Recommendation = {
  label: string;
  tone: RecommendationTone;
  score: number;
  factors: { key: string; impact: "up" | "down" | "flat"; detail: string }[];
};

export type RecommendationInput = {
  /** 0 = cheapest in peer set, 1 = most expensive */
  peerRankIndex: number;
  peerCount: number;
  /** (lastRunMin - previousRunMin) / previousRunMin when both exist */
  runToRunTrendPct: number | null;
  /** stddev/mean on prices of last run, or null */
  lastRunCoefficientOfVariation: number | null;
};

/**
 * Heuristic advisory for client reports — not financial advice.
 * Combines peer price position, short trend, and listing dispersion.
 */
export function buildRecommendation(input: RecommendationInput): Recommendation {
  const factors: Recommendation["factors"] = [];
  let score = 50;

  const n = Math.max(1, input.peerCount);
  const rankPct = input.peerRankIndex / Math.max(1, n - 1 || 1);
  // If only one peer, rankPct is NaN — treat as neutral peer position
  const peerPosition =
    n <= 1 ? 0.5 : Number.isFinite(rankPct) ? rankPct : 0.5;

  if (n > 1) {
    if (peerPosition <= 0.25) {
      score += 22;
      factors.push({
        key: "Comparación de marcas",
        impact: "up",
        detail: "Entre artículos equivalentes (mismo nombre y detalle), el precio observado está entre los más bajos.",
      });
    } else if (peerPosition >= 0.75) {
      score -= 22;
      factors.push({
        key: "Comparación de marcas",
        impact: "down",
        detail: "Respecto a otras marcas con el mismo artículo y detalle, el precio observado está entre los más altos.",
      });
    } else {
      factors.push({
        key: "Comparación de marcas",
        impact: "flat",
        detail: "Posición intermedia frente a otras marcas equivalentes.",
      });
    }
  } else {
    factors.push({
      key: "Comparación de marcas",
      impact: "flat",
      detail: "No hay otras marcas registradas con el mismo artículo y detalle para comparar.",
    });
  }

  const trend = input.runToRunTrendPct;
  if (trend != null && Number.isFinite(trend)) {
    if (trend < -0.02) {
      score += 12;
      factors.push({
        key: "Tendencia entre corridas",
        impact: "up",
        detail: `El mínimo por corrida bajó ~${(Math.abs(trend) * 100).toFixed(1)}% respecto a la corrida anterior.`,
      });
    } else if (trend > 0.03) {
      score -= 14;
      factors.push({
        key: "Tendencia entre corridas",
        impact: "down",
        detail: `El mínimo por corrida subió ~${(trend * 100).toFixed(1)}% respecto a la corrida anterior.`,
      });
    } else {
      factors.push({
        key: "Tendencia entre corridas",
        impact: "flat",
        detail: "Variación acotada entre la última corrida y la anterior.",
      });
    }
  } else {
    factors.push({
      key: "Tendencia entre corridas",
      impact: "flat",
      detail: "No hay suficientes corridas con precio para calcular tendencia.",
    });
  }

  const cv = input.lastRunCoefficientOfVariation;
  if (cv != null && Number.isFinite(cv)) {
    if (cv > 0.35) {
      score -= 12;
      factors.push({
        key: "Dispersión de publicaciones",
        impact: "down",
        detail:
          "En la última corrida hay mucha dispersión entre publicaciones; conviene revisar condiciones (vendedor, envío, modelo).",
      });
    } else if (cv < 0.12) {
      score += 6;
      factors.push({
        key: "Dispersión de publicaciones",
        impact: "up",
        detail: "En la última corrida los precios observados están relativamente alineados.",
      });
    } else {
      factors.push({
        key: "Dispersión de publicaciones",
        impact: "flat",
        detail: "Dispersión moderada entre publicaciones de la última corrida.",
      });
    }
  } else {
    factors.push({
      key: "Dispersión de publicaciones",
      impact: "flat",
      detail: "No hay datos suficientes en la última corrida para medir dispersión.",
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tone: RecommendationTone;
  let label: string;
  if (score >= 68) {
    tone = "positive";
    label = "Se observa un contexto favorable para evaluar la compra";
  } else if (score <= 38) {
    tone = "negative";
    label = "Se observa un contexto desfavorable: conviene esperar o comparar más";
  } else {
    tone = "neutral";
    label = "Situación mixta: conviene comparar publicaciones puntuales antes de decidir";
  }

  return { label, tone, score, factors };
}
