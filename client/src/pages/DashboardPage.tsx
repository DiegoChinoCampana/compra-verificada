import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../api";
import { isFromResultsState, resultsListPath } from "../resultsNavState";
import type {
  AnalyticsScopePayload,
  Article,
  CriteriaRow,
  DispersionRow,
  PeerRow,
  PriceSeriesRow,
} from "../types";

export function DashboardPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const location = useLocation();
  const articleId = Number(id);
  const fromResults = isFromResultsState(location.state);
  const backTo = fromResults ? resultsListPath(location.state) : "/articulos";
  const backLabel = fromResults ? "Resultados" : "Artículos";

  const scopeSuffix = useMemo(() => {
    const q = new URLSearchParams();
    const pt = sp.get("productTitle")?.trim();
    const sl = sp.get("seller")?.trim();
    if (pt) q.set("productTitle", pt);
    if (sl) q.set("seller", sl);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [sp]);
  const [article, setArticle] = useState<Article | null>(null);
  const [series, setSeries] = useState<PriceSeriesRow[]>([]);
  const [dispersion, setDispersion] = useState<DispersionRow[]>([]);
  const [criteria, setCriteria] = useState<CriteriaRow | null>(null);
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [bestPerRun, setBestPerRun] = useState<Record<string, unknown>[]>([]);
  const [sellers, setSellers] = useState<Record<string, unknown>[]>([]);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [scope, setScope] = useState<AnalyticsScopePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(articleId)) return;
    const ac = new AbortController();
    (async () => {
      setError(null);
      setScope(null);
      try {
        const a = await fetchJson<Article>(`/api/articles/${articleId}`, {
          signal: ac.signal,
        });
        const peerParams = new URLSearchParams({
          article: a.article,
          detail: a.detail ?? "",
          excludeId: String(a.id),
        });
        const pt = sp.get("productTitle")?.trim();
        const sl = sp.get("seller")?.trim();
        if (pt) peerParams.set("productTitle", pt);
        if (sl) peerParams.set("seller", sl);

        const [s, d, c, p, b, sel, sc] = await Promise.all([
          fetchJson<PriceSeriesRow[]>(
            `/api/analytics/article/${articleId}/price-series${scopeSuffix}`,
            { signal: ac.signal },
          ),
          fetchJson<DispersionRow[]>(
            `/api/analytics/article/${articleId}/dispersion${scopeSuffix}`,
            { signal: ac.signal },
          ),
          fetchJson<CriteriaRow>(`/api/analytics/article/${articleId}/criteria${scopeSuffix}`, {
            signal: ac.signal,
          }),
          fetchJson<PeerRow[]>(
            `/api/analytics/peers/by-article-detail?${peerParams.toString()}`,
            { signal: ac.signal },
          ),
          fetchJson<Record<string, unknown>[]>(
            `/api/analytics/article/${articleId}/best-per-run${scopeSuffix}`,
            { signal: ac.signal },
          ),
          fetchJson<Record<string, unknown>[]>(
            `/api/analytics/article/${articleId}/sellers${scopeSuffix}`,
            { signal: ac.signal },
          ),
          fetchJson<AnalyticsScopePayload>(
            `/api/analytics/article/${articleId}/analytics-scope${scopeSuffix}`,
            { signal: ac.signal },
          ),
        ]);
        if (ac.signal.aborted) return;
        setArticle(a);
        setSeries(s);
        setDispersion(d);
        setCriteria(c);
        setPeers(p);
        setBestPerRun(b);
        setSellers(sel);
        setScope(sc);
        const stale = await fetchJson<{ id: number }[]>(
          `/api/analytics/operational/stale-scrapes?days=7`,
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        if (stale.some((r) => r.id === articleId)) {
          setStaleNote("Este artículo figura con último scrape hace más de 7 días (o sin fecha).");
        } else {
          setStaleNote(null);
        }
      } catch (e) {
        if (!ac.signal.aborted) setError(String(e));
      }
    })();
    return () => ac.abort();
  }, [articleId, scopeSuffix, sp]);

  const chartData = useMemo(
    () =>
      series.map((r) => ({
        ...r,
        label: new Date(r.executed_at).toLocaleDateString("es-AR"),
      })),
    [series],
  );

  if (!Number.isInteger(articleId)) {
    return <p className="error">ID inválido.</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!article) {
    return <p>Cargando…</p>;
  }

  const lastDisp = dispersion.length ? dispersion[dispersion.length - 1] : null;

  return (
    <div>
      <p className="breadcrumb">
        <Link to={backTo} state={fromResults ? location.state : undefined}>
          {backLabel}
        </Link>{" "}
        / Resumen de ficha
      </p>
      <header className="page-head">
        <div>
          <h1>
            {article.article}
            {article.brand ? ` · ${article.brand}` : ""}
          </h1>
          <p className="muted">
            {article.detail ?? "Sin detalle"} · Orden listado: {article.ordered_by ?? "—"}
          </p>
          {staleNote && <p className="warn">{staleNote}</p>}
          {scope?.scopeMode === "manual" && scope.displayTitle ? (
            <p className="muted small" style={{ marginTop: "0.5rem" }}>
              Alcance fijado por título de publicación «{scope.displayTitle}»
              {scope.sellerFilter ? ` · tienda/vendedor contiene «${scope.sellerFilter}»` : ""}.
            </p>
          ) : scope?.hasCanonicalProduct && scope.displayTitle ? (
            <p className="muted small" style={{ marginTop: "0.5rem" }}>
              Comparaciones y gráficos usan solo publicaciones del mismo producto (título normalizado).
              Referencia: «{scope.displayTitle}»
            </p>
          ) : scope && !scope.hasCanonicalProduct ? (
            <p className="muted small" style={{ marginTop: "0.5rem" }}>
              No hay título canónico entre corridas: se consideran todas las publicaciones con precio.
            </p>
          ) : null}
        </div>
      </header>

      <section className="card block">
        <h2>1 · Evolución del precio por corrida</h2>
        <p className="muted small">
          Mínimo y promedio por corrida, solo entre listados del mismo producto (mismo título).
        </p>
        {chartData.length ? (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="min_price"
                  name="Mínimo"
                  stroke="#0d5c52"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="avg_price"
                  name="Promedio"
                  stroke="#5a9a8f"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="muted">Todavía no hay corridas con precio para este artículo.</p>
        )}
      </section>

      <section className="card block">
        <h2>2 · Mejor precio observado por corrida</h2>
        <p className="muted small">
          Publicación más barata en cada corrida entre las del mismo título de producto.
        </p>
        {bestPerRun.length ? (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Precio</th>
                  <th>Título</th>
                </tr>
              </thead>
              <tbody>
                {bestPerRun.map((r) => (
                  <tr key={String(r.scrape_run_id)}>
                    <td>{new Date(String(r.executed_at)).toLocaleString("es-AR")}</td>
                    <td>
                      {Number(r.price).toLocaleString("es-AR", {
                        style: "currency",
                        currency: "ARS",
                      })}
                    </td>
                    <td className="cell-clip">{String(r.title ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Sin datos.</p>
        )}
      </section>

      <section className="card block">
        <h2>3 · Dispersión en la última corrida</h2>
        <p className="muted small">
          Sobre la última corrida con datos, solo entre publicaciones del mismo título de producto.
        </p>
        {lastDisp ? (
          <ul className="kv">
            <li>
              <span>Publicaciones</span>
              <strong>{lastDisp.listing_count}</strong>
            </li>
            <li>
              <span>Mín / máx</span>
              <strong>
                {lastDisp.min_price?.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}{" "}
                —{" "}
                {lastDisp.max_price?.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
              </strong>
            </li>
            <li>
              <span>CV (σ/μ)</span>
              <strong>
                {lastDisp.coefficient_of_variation != null
                  ? (lastDisp.coefficient_of_variation * 100).toFixed(1) + "%"
                  : "—"}
              </strong>
            </li>
          </ul>
        ) : (
          <p className="muted">Sin datos de dispersión.</p>
        )}
      </section>

      <section className="card block">
        <h2>4 · Vendedores (últimos 90 días)</h2>
        <p className="muted small">
          Frecuencia y precios mínimos por vendedor, solo listados del mismo título de producto.
        </p>
        {sellers.length ? (
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
                {sellers.map((s) => (
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
        ) : (
          <p className="muted">Sin datos de vendedores.</p>
        )}
      </section>

      <section className="card block">
        <h2>5 · Criterios tienda oficial / envío gratis</h2>
        <p className="muted small">Conteos solo sobre publicaciones del mismo título de producto.</p>
        {criteria ? (
          <ul className="kv">
            <li>
              <span>Resultados totales</span>
              <strong>{criteria.total_results}</strong>
            </li>
            <li>
              <span>Requirieron tienda oficial</span>
              <strong>{criteria.required_official_count}</strong> (cumplidos:{" "}
              {criteria.official_met_count})
            </li>
            <li>
              <span>Requirieron envío gratis</span>
              <strong>{criteria.required_free_ship_count}</strong> (cumplidos:{" "}
              {criteria.free_ship_met_count})
            </li>
          </ul>
        ) : (
          <p className="muted">Sin datos.</p>
        )}
      </section>

      <section className="card block">
        <h2>6 · Operación y pares de marca</h2>
        <p className="muted small">
          Otros artículos con el mismo nombre y detalle (otras marcas), excluyendo este ID. El mínimo
          por corrida usa el mismo criterio de título de producto en cada artículo.
        </p>
        {peers.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Marca</th>
                  <th>Mín. última corrida</th>
                  <th>Fecha corrida</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/articulos/${p.id}`} state={fromResults ? location.state : undefined}>
                        {p.brand ?? "(sin marca)"}
                      </Link>
                    </td>
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
        ) : (
          <p className="muted">No hay otros registros equivalentes para comparar.</p>
        )}
      </section>
    </div>
  );
}
