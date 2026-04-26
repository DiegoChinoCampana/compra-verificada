import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { RESULTS_SCRAPED_LEDE } from "../resultsScrapedLede";
import { isFromResultsState, resultsListPath } from "../resultsNavState";
import type { Article, ArticleResultsPagePayload } from "../types";

const PAGE_SIZE = 100;

function boolLabel(v: boolean | null | undefined): string {
  if (v === true) return "Sí";
  if (v === false) return "No";
  return "—";
}

function shortProductKey(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return "—";
  const t = String(s).trim();
  return t.length > 40 ? `${t.slice(0, 38)}…` : t;
}

export function ArticleResultsPage() {
  const { id } = useParams();
  const articleId = Number(id);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const fromResults = isFromResultsState(location.state);
  const backTo = fromResults ? resultsListPath(location.state) : "/articulos";
  const backLabel = fromResults ? "Resultados" : "Artículos";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [article, setArticle] = useState<Article | null>(null);
  const [payload, setPayload] = useState<ArticleResultsPagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const pt = params.get("productTitle")?.trim() ?? "";
  const sl = params.get("seller")?.trim() ?? "";

  const qs = useMemo(() => {
    const q = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    if (pt) q.set("productTitle", pt);
    if (sl) q.set("seller", sl);
    return q.toString();
  }, [page, pt, sl]);

  useEffect(() => {
    if (!Number.isInteger(articleId)) return;
    const ac = new AbortController();
    (async () => {
      setError(null);
      try {
        const [a, p] = await Promise.all([
          fetchJson<Article>(`/api/articles/${articleId}`, { signal: ac.signal }),
          fetchJson<ArticleResultsPagePayload>(`/api/articles/${articleId}/results?${qs}`, {
            signal: ac.signal,
          }),
        ]);
        if (ac.signal.aborted) return;
        setArticle(a);
        setPayload(p);
      } catch (e) {
        if (!ac.signal.aborted) setError(String(e));
      }
    })();
    return () => ac.abort();
  }, [articleId, qs, reloadNonce]);

  function goToPage(next: number) {
    const p = new URLSearchParams(params);
    if (next <= 1) p.delete("page");
    else p.set("page", String(next));
    setParams(p);
  }

  if (!Number.isInteger(articleId)) {
    return <p className="error">ID inválido.</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!article || !payload) {
    return <p>Cargando…</p>;
  }

  const totalPages = Math.max(1, Math.ceil(payload.total / payload.limit));
  const from = payload.total === 0 ? 0 : payload.offset + 1;
  const to = Math.min(payload.offset + payload.rows.length, payload.total);

  return (
    <div>
      <p className="breadcrumb">
        <Link to={backTo} state={fromResults ? location.state : undefined}>
          {backLabel}
        </Link>{" "}
        / Listados scrapeados
      </p>
      {fromResults ? <p className="lede">{RESULTS_SCRAPED_LEDE}</p> : null}

      <header className="page-head">
        <div>
          <h1>Listados por corrida</h1>
          <p className="muted">
            {article.article}
            {article.brand ? ` · ${article.brand}` : ""} · ID {articleId}
          </p>
          <p className="muted small">
            Cada fila es una publicación capturada en una corrida. Orden: corrida más reciente
            primero.
          </p>
          {pt ? (
            <p className="muted small" style={{ marginTop: "0.35rem" }}>
              Listado acotado al título de publicación indicado en la URL
              {sl ? ` y a la tienda/vendedor «${sl}»` : ""}.
            </p>
          ) : null}
        </div>
      </header>

      <p className="muted small" style={{ marginBottom: "0.75rem" }}>
        Mostrando {from}–{to} de {payload.total} · Página {page} de {totalPages}{" "}
        <button type="button" onClick={() => setReloadNonce((n) => n + 1)} style={{ marginLeft: "0.35rem" }}>
          Recargar datos
        </button>
      </p>

      <div className="table-wrap card">
        <table className="table table--dense table--results-list">
          <thead>
            <tr>
              <th>Corrida</th>
              <th>Fecha corrida</th>
              <th>Precio</th>
              <th>Rating</th>
              <th>Título</th>
              <th title="Clave semántica de producto (batch clustering)">product_key</th>
              <th>Clúst.</th>
              <th>Vendedor</th>
              <th>Rep.</th>
              <th>Capturado</th>
              <th>Criterio</th>
              <th>T. oficial</th>
              <th>Env. gratis</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.scrape_run_id}</td>
                <td>{new Date(r.run_executed_at).toLocaleString("es-AR")}</td>
                <td>
                  {r.price != null
                    ? r.price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })
                    : "—"}
                </td>
                <td>{r.rating != null ? r.rating.toFixed(1) : "—"}</td>
                <td>{r.title ?? "—"}</td>
                <td className="muted small">{shortProductKey(r.product_key)}</td>
                <td className="muted small">
                  {r.product_cluster_id != null ? r.product_cluster_id : "—"}
                </td>
                <td>{r.seller ?? "—"}</td>
                <td>{r.seller_score ?? "—"}</td>
                <td>{new Date(r.created_at).toLocaleString("es-AR")}</td>
                <td>{r.scrape_run_criteria ?? "—"}</td>
                <td>
                  {boolLabel(r.official_store_required)} / {boolLabel(r.official_store_applied)}
                </td>
                <td>
                  {boolLabel(r.free_shipping_required)} / {boolLabel(r.free_shipping_applied)}
                </td>
                <td>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payload.rows.length && (
          <p className="muted pad">No hay resultados guardados para este artículo.</p>
        )}
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
    </div>
  );
}
