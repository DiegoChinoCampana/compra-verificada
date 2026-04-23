import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import type { Article } from "../types";

function filtersFromParams(p: URLSearchParams) {
  return {
    article: p.get("article") ?? "",
    brand: p.get("brand") ?? "",
    detail: p.get("detail") ?? "",
    enabled: p.get("enabled") ?? "",
  };
}

export function ArticlesPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromParams(params));
  const [rows, setRows] = useState<Article[]>([]);
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
        const data = await fetchJson<Article[]>(`/api/articles?${params.toString()}`);
        if (!cancelled) setRows(data);
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
    if (filters.enabled === "true" || filters.enabled === "false") {
      q.set("enabled", filters.enabled);
    }
    setParams(q);
  }

  return (
    <div>
      <h1>Artículos scrapeados</h1>
      <p className="lede">
        Filtrá por artículo, marca o detalle para revisar las fichas de búsqueda configuradas. Los
        precios y comparaciones por <strong>mismo título de publicación</strong> están en{" "}
        <Link to="/resultados">Resultados</Link> y en <Link to="/analisis">Análisis</Link> (estabilidad
        de precios).
      </p>

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
            Estado
            <select
              value={filters.enabled}
              onChange={(e) => setFilters((f) => ({ ...f, enabled: e.target.value }))}
            >
              <option value="">Todos</option>
              <option value="true">Habilitados</option>
              <option value="false">Deshabilitados</option>
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit">Aplicar filtros</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Cargando…</p>
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Artículo</th>
                <th>Marca</th>
                <th>Detalle</th>
                <th>Último scrape</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.article}</td>
                  <td>{a.brand ?? "—"}</td>
                  <td>{a.detail ?? "—"}</td>
                  <td>
                    {a.last_scraped_at
                      ? new Date(a.last_scraped_at).toLocaleString("es-AR")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted pad">Sin resultados con estos filtros.</p>}
        </div>
      )}
    </div>
  );
}
