/** Fila con clave de agrupación + título de listado (API análisis). */
export type AnalysisProductRow = {
  group_key: string;
  product_title: string;
  sample_listing_title: string;
};

function listingTitle(row: AnalysisProductRow): string {
  const t = row.sample_listing_title?.trim();
  if (t) return t;
  return row.product_title?.trim() || "—";
}

/** Si hay `product_key` de batch (`cluster:…`), muestra la clave y debajo el título ML representativo. */
export function AnalysisProductCell({ row }: { row: AnalysisProductRow }) {
  const key = row.group_key.trim();
  const showKey = key.startsWith("cluster:");
  const title = listingTitle(row);
  return (
    <div className="cell-title-multiline">
      {showKey ? (
        <div
          className="muted small"
          style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-word" }}
          title="product_key"
        >
          {key}
        </div>
      ) : null}
      <div>{title}</div>
    </div>
  );
}

export function analysisProductTooltipTitle(row: AnalysisProductRow): string {
  const key = row.group_key.trim();
  const title = listingTitle(row);
  if (key.startsWith("cluster:")) return `${key}\n${title}`;
  return title;
}
