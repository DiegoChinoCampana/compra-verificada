/** Migas: enlace «Resumen» desde la Guía Hot Sale guarda esto en `location.state`. */
export type FromHotSaleLocationState = {
  from: "hot-sale";
  /** Ventana de días elegida en la guía (opcional). */
  days?: number;
};

export function isFromHotSaleState(s: unknown): s is FromHotSaleLocationState {
  return (
    typeof s === "object" &&
    s !== null &&
    (s as FromHotSaleLocationState).from === "hot-sale"
  );
}

const ALLOWED_DAYS = new Set([10, 30, 60]);

export function hotSaleListPath(state: FromHotSaleLocationState | null | undefined): string {
  const d = state?.days;
  if (typeof d === "number" && ALLOWED_DAYS.has(d)) {
    return `/guia-hot-sale?days=${d}`;
  }
  return "/guia-hot-sale";
}
