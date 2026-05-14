import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import {
  clientDisclaimer,
  clientFactorHeading,
  clientScopeSubtitle,
  impactIcon,
  softenRecommendationCopy,
} from "../reportClientCopy";
import { RESULTS_SCRAPED_LEDE } from "../resultsScrapedLede";
import { hotSaleListPath, isFromHotSaleState } from "../hotSaleNavState";
import { isFromResultsState, resultsListPath } from "../resultsNavState";
import { asHtml2PdfOptions } from "../pdfHtml2PdfOptions";
import type { ReportPayload } from "../types";

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, 48);
}

const toneClass: Record<string, string> = {
  positive: "rec rec--pos",
  neutral: "rec rec--neu",
  negative: "rec rec--neg",
};

export function ClientReportPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const location = useLocation();
  const articleId = Number(id);
  const fromResults = isFromResultsState(location.state);
  const fromHotSale = isFromHotSaleState(location.state);
  const backTo = fromResults
    ? resultsListPath(location.state)
    : fromHotSale
      ? hotSaleListPath(location.state)
      : "/articulos";
  const backLabel = fromResults ? "Resultados" : fromHotSale ? "Guía Hot Sale" : "Artículos";
  const reportSuffix = useMemo(() => {
    const q = new URLSearchParams();
    const pk = sp.get("productKey")?.trim();
    const pt = sp.get("productTitle")?.trim();
    const sl = sp.get("seller")?.trim();
    if (pk) q.set("productKey", pk);
    if (pt) q.set("productTitle", pt);
    if (sl) q.set("seller", sl);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [sp]);

  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

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

  const priceStory = useMemo(() => {
    if (!data?.sections.priceSeries?.length) return null;
    const s = data.sections.priceSeries;
    if (s.length < 2) return null;
    const first = s[0]!.min_price;
    const last = s[s.length - 1]!.min_price;
    if (!(first > 0) || !Number.isFinite(last)) return null;
    const ch = (last - first) / first;
    const pct = (ch * 100).toFixed(1);
    if (ch < -0.02) {
      return `Entre el primer y el último relevamiento, el precio más bajo publicado bajó alrededor del ${Math.abs(Number(pct))} %.`;
    }
    if (ch > 0.02) {
      return `Entre el primer y el último relevamiento, el precio más bajo publicado subió alrededor del ${pct} %.`;
    }
    return "Los precios más bajos relevados se mantuvieron relativamente estables en el período observado.";
  }, [data]);

  async function handleDownloadPdf() {
    const root = document.getElementById("client-report-pdf-root");
    if (!root) return;
    const a = data?.article;
    if (!a) return;
    setPdfBusy(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set(
          asHtml2PdfOptions({
            /* Un poco más de aire que 10 mm: html2canvas recorta al borde del nodo y los bordes de tarjeta se veían pegados. */
            margin: [13, 13, 13, 13],
            filename: `CompraVerificada_resumen_${articleId}_${sanitizeFilenamePart(a.article)}.pdf`,
            image: { type: "jpeg", quality: 0.92 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              logging: false,
              scrollX: 0,
              scrollY: -window.scrollY,
              windowWidth: document.documentElement.scrollWidth,
            },
            jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
            /* Sin `before: [...]`: los saltos forzados por sección vaciaban hojas enteras.
               css+legacy + break-inside / avoid en tablas mantiene filas íntegras. */
            pagebreak: {
              mode: ["css", "legacy"],
              avoid: [".table-wrap", ".table", "tr", ".client-report__rec"],
            },
          }),
        )
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

  if (!Number.isInteger(articleId)) {
    return <p className="error">ID inválido.</p>;
  }
  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p>Cargando resumen…</p>;
  }

  const { article, sections, recommendation, generatedAt, analyticsScope } = data;
  const scopeLine = analyticsScope ? clientScopeSubtitle(analyticsScope) : null;
  const brandDetailLine = [article.brand?.trim(), article.detail?.trim()].filter(Boolean).join(" · ");

  return (
    <div className="report client-report">
      <div className="no-print report-toolbar">
        <div className="report-toolbar__links">
          <Link
            to={backTo}
            state={fromResults || fromHotSale ? location.state : undefined}
          >
            {backLabel}
          </Link>
          <Link to={`/informe/${articleId}${reportSuffix}`}>Informe detallado (equipo)</Link>
          {fromResults ? (
            <Link to="/articulos">Artículos</Link>
          ) : fromHotSale ? (
            <>
              <Link to="/articulos">Artículos</Link>
              <Link to="/resultados">Resultados</Link>
            </>
          ) : (
            <Link to="/resultados">Resultados</Link>
          )}
        </div>
        <button type="button" className="button" disabled={pdfBusy} onClick={() => void handleDownloadPdf()}>
          {pdfBusy ? "Generando PDF…" : "Descargar PDF"}
        </button>
      </div>

      {fromResults ? <p className="lede no-print">{RESULTS_SCRAPED_LEDE}</p> : null}

      <div id="client-report-pdf-root" className="report-pdf-root">
        <header className="report-header client-report__hero">
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
              <p className="muted small">CompraVerificada · Resumen para compartir</p>
              <h1>{article.article}</h1>
              {brandDetailLine ? (
                <p className="client-report__subtitle">{brandDetailLine}</p>
              ) : (
                <p className="client-report__subtitle muted">Producto monitoreado</p>
              )}
              <p className="muted">
                {new Date(generatedAt).toLocaleDateString("es-AR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              {scopeLine ? <p className="muted small client-report__scope">{scopeLine}</p> : null}
            </div>
          </div>
        </header>

        <section className={`rec ${toneClass[recommendation.tone] ?? "rec rec--neu"} client-report__rec`}>
          <div>
            <div className="rec__label">Qué conviene tener en cuenta</div>
            <h2>{recommendation.label}</h2>
          </div>
          <ul className="rec__factors client-report__factors">
            {recommendation.factors.map((f) => (
              <li key={f.key}>
                <span className="client-report__factor-icon" aria-hidden>
                  {impactIcon(f.impact)}
                </span>
                <span>
                  <strong>{clientFactorHeading(f.key)}</strong>
                  <br />
                  <span className="muted small">{softenRecommendationCopy(f.detail)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="disclaimer client-report__disclaimer client-report__disclaimer--pdf">{clientDisclaimer()}</p>

        {priceStory ? (
          <section className="card block client-report__highlight">
            <h3>En una frase</h3>
            <p className="client-report__lead">{priceStory}</p>
          </section>
        ) : null}

        <section className="card block">
          <h3>Precios de otras marcas (referencia)</h3>
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            Valores públicos del mismo artículo en otras búsquedas configuradas. La fila resaltada es la tuya.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Marca</th>
                  <th>Precio más bajo publicado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {sections.peerComparisonByBrand.map((p) => (
                  <tr key={p.id} className={p.id === article.id ? "row-highlight" : undefined}>
                    <td>{p.brand ?? "—"}</td>
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
                        ? new Date(p.latest_run_at).toLocaleDateString("es-AR", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
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
          <h3>Cómo se movieron los precios</h3>
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            Mínimo y promedio relevados en cada actualización (solo publicaciones equivalentes al alcance
            elegido).
          </p>
          {analyticsScope?.scopeMode === "auto" && analyticsScope.hasCanonicalProduct ? (
            <p className="muted small" style={{ marginBottom: "0.75rem", maxWidth: "48rem" }}>
              <strong>¿Faltan fechas que sí ves en Resultados?</strong> Con alcance automático solo
              entran publicaciones equivalentes al producto de referencia
              {analyticsScope.displayTitle && !analyticsScope.displayTitle.trim().toLowerCase().startsWith("cluster:")
                ? ` («${analyticsScope.displayTitle}»)`
                : ""}
              . Por día calendario se usa <strong>una</strong> actualización (la última de ese día con datos).
              Si en Resultados aparece otra variante (modelo, color o texto de publicación distinto) que no
              coincide con esa referencia, no entra en esta serie aunque comparta categoría y marca. Para
              acotar a una publicación concreta, abrí este resumen desde el enlace de esa fila en{" "}
              <Link to="/resultados">Resultados</Link>.
            </p>
          ) : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Precio más bajo</th>
                  <th>Promedio</th>
                  <th>Publicaciones</th>
                </tr>
              </thead>
              <tbody>
                {sections.priceSeries.map((r) => (
                  <tr key={r.scrape_run_id}>
                    <td>
                      {new Date(r.executed_at).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
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
      </div>
    </div>
  );
}
