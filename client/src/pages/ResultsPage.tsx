import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { productScopeQueryString } from "../productScopeUrl";
import { RESULTS_SCRAPED_LEDE } from "../resultsScrapedLede";
import type { FromResultsLocationState } from "../resultsNavState";
import type { ScrapedResultListRow, ScrapedResultsPagePayload } from "../types";

const PAGE_SIZE = 50;

function shortProductKey(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return "—";
  const t = String(s).trim();
  return t.length > 32 ? `${t.slice(0, 30)}…` : t;
}

function filtersFromParams(p: URLSearchParams) {
  return {
    article: p.get("article") ?? "",
    brand: p.get("brand") ?? "",
    detail: p.get("detail") ?? "",
    title: p.get("title") ?? "",
    seller: p.get("seller") ?? "",
  };
}

export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromParams(params));
  const [payload, setPayload] = useState<ScrapedResultsPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilters(filtersFromParams(params));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qsAll = params.toString();
        const data = await fetchJson<ScrapedResultsPagePayload>(
          `/api/results${qsAll ? `?${qsAll}` : ""}`,
        );
        if (!cancelled) setPayload(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (filters.article.trim()) q.set("article", filters.article.trim());
    if (filters.brand.trim()) q.set("brand", filters.brand.trim());
    if (filters.detail.trim()) q.set("detail", filters.detail.trim());
    if (filters.title.trim()) q.set("title", filters.title.trim());
    if (filters.seller.trim()) q.set("seller", filters.seller.trim());
    q.set("limit", String(PAGE_SIZE));
    q.set("page", "1");
    setParams(q);
  }

  const page = Math.max(1, Number(params.get("page")) || 1);
  const totalPages = payload ? Math.max(1, Math.ceil(payload.total / payload.limit)) : 1;

  function goToPage(next: number) {
    const q = new URLSearchParams(params);
    if (next <= 1) q.delete("page");
    else q.set("page", String(next));
    if (!q.get("limit")) q.set("limit", String(PAGE_SIZE));
    setParams(q);
  }

  function scopeForRow(r: ScrapedResultListRow) {
    return productScopeQueryString(r.title, r.seller);
  }

  const resultsNavState: FromResultsLocationState = {
    from: "results",
    resultsQuery: params.toString(),
  };

  return (
    <div>
      <h1>Resultados scrapeados</h1>
      <p className="lede">{RESULTS_SCRAPED_LEDE}</p>

      <form className="card filters" onSubmit={applyFilters}>
        <div className="field-grid">
          <label>
            Artículo
            <input
              value={filters.article}
              onChange={(e) => setFilters((f) => ({ ...f, article: e.target.value }))}
              placeholder="Ej: lavarropas"
            />
          </label>
          <label>
            Marca
            <input
              value={filters.brand}
              onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))}
              placeholder="Ej: Drean"
            />
          </label>
          <label>
            Detalle
            <input
              value={filters.detail}
              onChange={(e) => setFilters((f) => ({ ...f, detail: e.target.value }))}
              placeholder="Ej: 8 kg"
            />
          </label>
          <label>
            Título publicación
            <input
              value={filters.title}
              onChange={(e) => setFilters((f) => ({ ...f, title: e.target.value }))}
              placeholder="Contiene…"
            />
          </label>
          <label>
            Tienda / vendedor
            <input
              value={filters.seller}
              onChange={(e) => setFilters((f) => ({ ...f, seller: e.target.value }))}
              placeholder="Contiene…"
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit">Aplicar filtros</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading || !payload ? (
        <p>Cargando…</p>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            Mostrando {payload.offset + 1}–{Math.min(payload.offset + payload.rows.length, payload.total)}{" "}
            de {payload.total} · Página {page} de {totalPages}
          </p>
          <div className="table-wrap card">
            <table className="table table--dense table--results-list">
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Marca</th>
                  <th>Detalle</th>
                  <th>Título</th>
                  <th title="Clave semántica (batch)">product_key</th>
                  <th>Clúst.</th>
                  <th>Tienda</th>
                  <th>Precio</th>
                  <th>Corrida</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payload.rows.map((r) => (
                  <tr key={r.result_id}>
                    <td>{r.article}</td>
                    <td>{r.brand ?? "—"}</td>
                    <td>{r.detail ?? "—"}</td>
                    <td>{r.title ?? "—"}</td>
                    <td className="muted small">{shortProductKey(r.product_key)}</td>
                    <td className="muted small">
                      {r.product_cluster_id != null ? r.product_cluster_id : "—"}
                    </td>
                    <td>{r.seller ?? "—"}</td>
                    <td>
                      {r.price != null
                        ? r.price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })
                        : "—"}
                    </td>
                    <td>{new Date(r.run_executed_at).toLocaleString("es-AR")}</td>
                    <td className="actions">
                      <Link to={`/articulos/${r.article_id}${scopeForRow(r)}`} state={resultsNavState}>
                        Tablero
                      </Link>
                      <Link
                        to={`/articulos/${r.article_id}/listados${scopeForRow(r)}`}
                        state={resultsNavState}
                      >
                        Listados
                      </Link>
                      <Link to={`/informe/${r.article_id}${scopeForRow(r)}`} state={resultsNavState}>
                        Informe
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payload.rows.length && <p className="muted pad">Sin filas con estos filtros.</p>}
          </div>
          {totalPages > 1 && (
            <nav className="pager" aria-label="Paginación">
              <button
                type="button"
                className="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Anterior
              </button>
              <span className="muted small">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
