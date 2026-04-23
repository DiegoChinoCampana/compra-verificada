import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import { isFromResultsState, resultsListPath } from "../resultsNavState";
import type { ReportPayload } from "../types";

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, 48);
}

const toneClass: Record<string, string> = {
  positive: "rec rec--pos",
  neutral: "rec rec--neu",
  negative: "rec rec--neg",
};

export function ReportPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const location = useLocation();
  const articleId = Number(id);
  const fromResults = isFromResultsState(location.state);
  const backTo = fromResults ? resultsListPath(location.state) : "/articulos";
  const backLabel = fromResults ? "← Resultados" : "← Artículos";
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const reportSuffix = useMemo(() => {
    const q = new URLSearchParams();
    const pt = sp.get("productTitle")?.trim();
    const sl = sp.get("seller")?.trim();
    if (pt) q.set("productTitle", pt);
    if (sl) q.set("seller", sl);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [sp]);

  useEffect(() => {
    if (!Number.isInteger(articleId)) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const rep = await fetchJson<ReportPayload>(
          `/api/report/article/${articleId}${reportSuffix}`,
        );
        if (!cancelled) setData(rep);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId, reportSuffix]);

  if (!Number.isInteger(articleId)) {
    return <p className="error">ID inválido.</p>;
  }
  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p>Cargando informe…</p>;
  }

  const { article, sections, recommendation, disclaimer, generatedAt, analyticsScope } = data;

  async function handleDownloadPdf() {
    const root = document.getElementById("report-pdf-root");
    if (!root) return;
    const a = article;
    setPdfBusy(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `CompraVerificada_informe_${articleId}_${sanitizeFilenamePart(a.article)}.pdf`,
          image: { type: "jpeg", quality: 0.92 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(root)
        .save();
    } catch (e) {
      console.error(e);
      window.alert(
        "No se pudo generar el PDF. Probá de nuevo; si persiste, probá con Chrome o Edge.",
      );
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="report">
      <div className="no-print report-toolbar">
        <div className="report-toolbar__links">
          <Link to={backTo} state={fromResults ? location.state : undefined}>
            {backLabel}
          </Link>
          {fromResults ? (
            <Link to="/articulos">Artículos</Link>
          ) : (
            <Link to="/resultados">Resultados</Link>
          )}
        </div>
        <button type="button" className="button" disabled={pdfBusy} onClick={() => void handleDownloadPdf()}>
          {pdfBusy ? "Generando PDF…" : "Descargar PDF"}
        </button>
      </div>

      <div id="report-pdf-root" className="report-pdf-root">
        <header className="report-header">
          <div className="report-header__brand">
            <img
              className="report-header__logo"
              src="/brand-logo.png"
              alt="Compra Verificada"
              width={48}
              height={48}
              decoding="async"
            />
            <div className="report-header__brand-text">
              <p className="muted small">CompraVerificada · Informe para cliente</p>
              <h1>
                {article.article}
                {article.brand ? ` — ${article.brand}` : ""}
              </h1>
              <p className="muted">
                {article.detail ?? "Sin detalle"} · Generado{" "}
                {new Date(generatedAt).toLocaleString("es-AR")}
              </p>
            </div>
          </div>
        {analyticsScope?.scopeMode === "manual" && analyticsScope.displayTitle ? (
          <p className="muted small">
            Informe acotado al título «{analyticsScope.displayTitle}»
            {analyticsScope.sellerFilter ? ` y a la tienda/vendedor «${analyticsScope.sellerFilter}»` : ""}.
          </p>
        ) : analyticsScope?.hasCanonicalProduct && analyticsScope.displayTitle ? (
          <p className="muted small">
            Precios, dispersión, vendedores, criterios y comparación entre marcas se calcularon solo
            con publicaciones del mismo producto (título coincidente). Ejemplar: «
            {analyticsScope.displayTitle}»
          </p>
        ) : analyticsScope && !analyticsScope.hasCanonicalProduct ? (
          <p className="muted small">
            Sin título canónico entre corridas: se usaron todas las publicaciones con precio.
          </p>
        ) : null}
        </header>

      <section className={`rec ${toneClass[recommendation.tone] ?? "rec rec--neu"}`}>
        <div>
          <div className="rec__label">Síntesis</div>
          <h2>{recommendation.label}</h2>
          <p className="rec__score">Puntaje heurístico: {recommendation.score} / 100</p>
        </div>
        <ul className="rec__factors">
          {recommendation.factors.map((f) => (
            <li key={f.key}>
              <strong>{f.key}</strong>: {f.detail}
            </li>
          ))}
        </ul>
      </section>

      <p className="disclaimer">{disclaimer}</p>

      <section className="card block">
        <h3>Comparación con otras marcas (mismo artículo, detalle y título de producto)</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Marca</th>
                <th>Mín. última corrida</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {sections.peerComparisonByBrand.map((p) => (
                <tr key={p.id} className={p.id === article.id ? "row-highlight" : undefined}>
                  <td>{p.brand ?? "(sin marca)"}</td>
                  <td>
                    {p.latest_run_min_price != null
                      ? p.latest_run_min_price.toLocaleString("es-AR", {
                          style: "currency",
                          currency: "ARS",
                        })
                      : "—"}
                  </td>
                  <td>
                    {p.latest_run_at
                      ? new Date(p.latest_run_at).toLocaleString("es-AR")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card block">
        <h3>Evolución mínimo / promedio por corrida</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha corrida</th>
                <th>Mínimo</th>
                <th>Promedio</th>
                <th>Publicaciones</th>
              </tr>
            </thead>
            <tbody>
              {sections.priceSeries.map((r) => (
                <tr key={r.scrape_run_id}>
                  <td>{new Date(r.executed_at).toLocaleString("es-AR")}</td>
                  <td>
                    {r.min_price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                  </td>
                  <td>
                    {r.avg_price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                  </td>
                  <td>{r.listing_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card block">
        <h3>Mejor publicación por corrida</h3>
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Precio</th>
                <th>Título</th>
                <th>Vendedor</th>
              </tr>
            </thead>
            <tbody>
              {sections.bestOfferPerRun.map((r) => (
                <tr key={String(r.scrape_run_id)}>
                  <td>{new Date(String(r.executed_at)).toLocaleString("es-AR")}</td>
                  <td>
                    {Number(r.price).toLocaleString("es-AR", {
                      style: "currency",
                      currency: "ARS",
                    })}
                  </td>
                  <td className="cell-clip">{String(r.title ?? "")}</td>
                  <td>{String(r.seller ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card block">
        <h3>Dispersión por corrida</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Mín</th>
                <th>Máx</th>
                <th>CV</th>
              </tr>
            </thead>
            <tbody>
              {sections.dispersionPerRun.map((r) => (
                <tr key={r.scrape_run_id}>
                  <td>{new Date(r.executed_at).toLocaleString("es-AR")}</td>
                  <td>
                    {r.min_price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                  </td>
                  <td>
                    {r.max_price.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                  </td>
                  <td>
                    {r.coefficient_of_variation != null
                      ? (r.coefficient_of_variation * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card block">
        <h3>Vendedores frecuentes (90 días)</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Listados</th>
                <th>Rating prom.</th>
                <th>Mínimo visto</th>
              </tr>
            </thead>
            <tbody>
              {sections.sellers.map((s) => (
                <tr key={String(s.seller)}>
                  <td>{String(s.seller)}</td>
                  <td>{String(s.listing_count)}</td>
                  <td>{s.avg_rating != null ? Number(s.avg_rating).toFixed(2) : "—"}</td>
                  <td>
                    {s.min_price_seen != null
                      ? Number(s.min_price_seen).toLocaleString("es-AR", {
                          style: "currency",
                          currency: "ARS",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card block">
        <h3>Criterios declarados vs aplicados</h3>
        <ul className="kv">
          <li>
            <span>Total resultados</span>
            <strong>{sections.criteriaCompliance.total_results}</strong>
          </li>
          <li>
            <span>Tienda oficial (requerido / cumplido)</span>
            <strong>
              {sections.criteriaCompliance.required_official_count} /{" "}
              {sections.criteriaCompliance.official_met_count}
            </strong>
          </li>
          <li>
            <span>Envío gratis (requerido / cumplido)</span>
            <strong>
              {sections.criteriaCompliance.required_free_ship_count} /{" "}
              {sections.criteriaCompliance.free_ship_met_count}
            </strong>
          </li>
        </ul>
      </section>
      </div>
    </div>
  );
}
