/** Estado de navegación al salir de Resultados hacia ficha / listados / informe (miga de pan y “volver”). */
export type FromResultsLocationState = {
  from: "results";
  /** Query de `/resultados` (sin `?`). */
  resultsQuery: string;
};

export function isFromResultsState(s: unknown): s is FromResultsLocationState {
  return (
    typeof s === "object" &&
    s !== null &&
    (s as FromResultsLocationState).from === "results" &&
    typeof (s as FromResultsLocationState).resultsQuery === "string"
  );
}

export function resultsListPath(state: FromResultsLocationState | null | undefined): string {
  if (!state) return "/resultados";
  const q = state.resultsQuery.trim();
  return q ? `/resultados?${q}` : "/resultados";
}
