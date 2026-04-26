import type { Recommendation } from "./types";

/** Suaviza términos internos en textos generados por el motor de recomendación. */
export function softenRecommendationCopy(detail: string): string {
  return detail
    .replace(/\bLa última corrida\b/gi, "En la última actualización")
    .replace(/\búltima corrida\b/gi, "última actualización")
    .replace(/\bentre corridas\b/gi, "entre actualizaciones")
    .replace(/\bcorrida anterior\b/gi, "actualización anterior")
    .replace(/\bel mínimo por corrida\b/gi, "el precio más bajo relevado")
    .replace(/\bMínimo por corrida\b/gi, "Precio más bajo relevado")
    .replace(/\bpor corrida\b/gi, "en cada actualización")
    .replace(/\bcorrida\b/gi, "actualización")
    .replace(/\bcorridas\b/gi, "actualizaciones");
}

const FACTOR_TITLE_CLIENT: Record<string, string> = {
  "Comparación de marcas": "Tu marca frente al resto",
  "Tendencia entre corridas": "Tendencia de precios",
  "Dispersión de publicaciones": "Consistencia entre publicaciones",
};

export function clientFactorHeading(key: string): string {
  return FACTOR_TITLE_CLIENT[key] ?? key;
}

export function clientDisclaimer(): string {
  return "Información orientativa a partir de publicaciones en línea; no reemplaza asesoramiento profesional ni garantiza precio, stock ni condiciones finales de compra.";
}

/** Texto breve para el encabezado según alcance (sin jerga de clustering). */
export function clientScopeSubtitle(a: {
  scopeMode?: "auto" | "manual" | "key";
  hasCanonicalProduct?: boolean;
  displayTitle: string | null;
  sellerFilter?: string | null;
}): string | null {
  if (a.scopeMode === "key" && a.displayTitle) {
    return "Comparación acotada al mismo producto que elegiste en el listado.";
  }
  if (a.scopeMode === "manual" && a.displayTitle) {
    const s = a.sellerFilter?.trim();
    return s
      ? `Comparación acotada a publicaciones equivalentes a «${a.displayTitle}» y tienda «${s}».`
      : `Comparación acotada a publicaciones equivalentes a «${a.displayTitle}».`;
  }
  if (a.hasCanonicalProduct && a.displayTitle) {
    return `Comparamos publicaciones del mismo tipo de producto (referencia: «${a.displayTitle}»).`;
  }
  if (a.hasCanonicalProduct === false) {
    return "Incluimos todas las publicaciones con precio disponible en los relevamientos.";
  }
  return null;
}

export function impactIcon(impact: Recommendation["factors"][0]["impact"]): string {
  if (impact === "up") return "↑";
  if (impact === "down") return "↓";
  return "→";
}
