import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../api";
import type { FromHotSaleLocationState } from "../hotSaleNavState";
import type { HotSaleNarrativePayload, HotSaleRoundupPayload } from "../types";

const ALLOWED_DAYS = [10, 30, 60] as const;

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)} %`;
}

function trendPhrase(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct < -0.005) return "En la ventana, el precio mínimo relevado bajó respecto al inicio.";
  if (pct > 0.005) return "En la ventana, el precio mínimo relevado subió respecto al inicio.";
  return "Precio mínimo relevado relativamente estable en la ventana.";
}

function NarrativeBlock({ narrative }: { narrative: HotSaleNarrativePayload | null | undefined }) {
  if (!narrative?.bullets?.length) return null;
  return (
    <ul className="muted small" style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem", maxWidth: "22rem" }}>
      {narrative.bullets.map((b, i) => (
        <li key={`${i}-${b.slice(0, 48)}`} style={{ marginBottom: "0.35rem" }}>
          {b}
        </li>
      ))}
    </ul>
  );
}

function WindowRangeLine(props: {
  w_min: number | null | undefined;
  w_median: number | null | undefined;
  w_max: number | null | undefined;
  max_dod_drop_pct: number | null | undefined;
}) {
  const { w_min, w_median, w_max, max_dod_drop_pct } = props;
  if (w_min == null || !Number.isFinite(w_min)) return null;
  return (
    <div className="muted small" style={{ marginTop: "0.35rem" }}>
      En la ventana, mínimos diarios: bajo {fmtMoney(w_min)} · mediana {fmtMoney(w_median)} · alto {fmtMoney(w_max)}
      {max_dod_drop_pct != null && max_dod_drop_pct > 0.02 ? (
        <span> · mayor caída día a día ~{fmtPct(max_dod_drop_pct)}</span>
      ) : null}
    </div>
  );
}

export function HotSaleRoundupPage() {
  const [searchParams] = useSearchParams();
  const [days, setDays] = useState<10 | 30 | 60>(() => {
    const n = Number(searchParams.get("days"));
    return ALLOWED_DAYS.includes(n as (typeof ALLOWED_DAYS)[number]) ? (n as 10 | 30 | 60) : 30;
  });
  const [data, setData] = useState<HotSaleRoundupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const resumenNavState = useMemo<FromHotSaleLocationState>(() => ({ from: "hot-sale", days }), [days]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await fetchJson<HotSaleRoundupPayload>(`/api/report/hot-sale-roundup?days=${days}`);
        if (!cancelled) setData(p);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  function onDaysSubmit(e: FormEvent) {
    e.preventDefault();
  }

  const nLinkedVoted = useMemo(
    () => (data?.voted ?? []).filter((r) => r.articleId != null).length,
    [data],
  );

  const nAutoResolved = useMemo(
    () => (data?.voted ?? []).filter((r) => r.articleId != null && r.resolvedByMatch).length,
    [data],
  );

  const nApproximate = useMemo(
    () => (data?.voted ?? []).filter((r) => r.articleId != null && !!r.approximateMatch).length,
    [data],
  );

  return (
    <div className="report client-report">
      <div className="no-print report-toolbar">
        <div className="report-toolbar__links">
          <Link to="/articulos">Artículos</Link>
          <Link to="/resultados">Resultados</Link>
        </div>
      </div>

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
            <p className="muted small">CompraVerificada · Hot Sale</p>
            <h1>Lo que votaron + oportunidades con precio a la baja</h1>
            <p className="muted small">
              Primero figuran las opciones que eligió la audiencia en Instagram; abajo, hasta{" "}
              <strong>10 fichas más</strong> monitoreadas donde el precio mínimo relevante{" "}
              <strong>bajó</strong> en la ventana (excluimos las ya listadas arriba).
            </p>
          </div>
        </div>
      </header>

      <form className="card filters no-print" onSubmit={onDaysSubmit} style={{ marginBottom: "1.25rem" }}>
        <label>
          Días de ventana
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as 10 | 30 | 60)}
            style={{ marginLeft: "0.5rem" }}
          >
            {ALLOWED_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
        </label>
        <span className="muted small" style={{ marginLeft: "1rem" }}>
          Misma lógica que el tablero: una actualización por día y ficha; comparamos el mínimo de la primera y la
          última en la ventana (no es un “histórico completo” del Hot Sale).
        </span>
      </form>

      {loading ? <p>Cargando…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <p className="disclaimer client-report__disclaimer">{data.disclaimer}</p>
          <p className="muted small">
            Generado el{" "}
            {new Date(data.generatedAt).toLocaleString("es-AR", {
              dateStyle: "medium",
              timeStyle: "short",
            })}{" "}
            · ventana <strong>{data.days}</strong> días ·{" "}
            <strong>{nLinkedVoted}</strong> de {data.voted.length} productos del voto ya tienen una{" "}
            <strong>búsqueda monitoreada</strong> asignada (para precios y resumen).
            {nAutoResolved > 0 ? (
              <>
                {" "}
                De esos, <strong>{nAutoResolved}</strong> se detectaron automáticamente por nombre/marca/detalle (misma
                idea que el filtro de Artículos).
              </>
            ) : null}
            {nApproximate > 0 ? (
              <>
                {" "}
                En <strong>{nApproximate}</strong> caso{nApproximate === 1 ? "" : "s"} no hubo ficha con el criterio
                completo del voto: mostramos la <strong>coincidencia más cercana</strong> (p. ej. solo marca).
              </>
            ) : null}{" "}
            El resto sigue como texto del voto hasta que el equipo ajuste el criterio o el ID fijo.
          </p>

          <section className="card block" style={{ marginTop: "1.25rem" }}>
            <h2>1) Lo que votaron en Instagram</h2>
            {nLinkedVoted === 0 ? (
              <p
                className="muted small"
                style={{
                  marginBottom: "1rem",
                  padding: "0.75rem 1rem",
                  background: "var(--card-bg, rgba(0,0,0,0.04))",
                  borderRadius: "6px",
                }}
              >
                <strong>¿Por qué dice “pendiente de asignar”?</strong> Lo de Instagram es solo el nombre que votó la
                gente. Si no encontramos una ficha que coincida por los criterios configurados, no hay monitoreo para
                esa fila. Podés fijar el <strong>ID en la config del servidor</strong> o afinar los fragmentos artículo /
                marca / detalle (como en <Link to="/articulos">Artículos</Link>) para que la búsqueda automática
                encuentre la ficha correcta.
              </p>
            ) : null}
            <p className="muted small">
              Además del primer vs último día con dato, miramos el <strong>rango y la mediana</strong> de los mínimos
              diarios y si hubo <strong>caídas fuertes</strong> entre un día y el siguiente; eso ayuda a detectar
              patrones tipo precios más altos antes de una baja (posible “inflado”) y no guiarse solo por el último
              número.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Encuesta / historia</th>
                    <th>Opción (Instagram)</th>
                    <th>Búsqueda (ficha)</th>
                    <th>Tendencia y lectura</th>
                    <th>Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.voted.map((r, i) => (
                    <tr key={`${r.pollLabel}-${r.instagramLabel}-${i}`}>
                      <td className="muted small">{r.pollLabel}</td>
                      <td>{r.instagramLabel}</td>
                      <td>
                        {r.articleId != null ? (
                          <>
                            <strong>#{r.articleId}</strong>
                            {r.resolvedByMatch ? (
                              <span className="muted small" title="ID hallado por coincidencia (ILIKE) con artículo/marca/detalle">
                                {" "}
                                (auto)
                              </span>
                            ) : null}
                            {r.approximateMatch ? (
                              <div
                                className="small"
                                style={{
                                  marginTop: "0.35rem",
                                  padding: "0.35rem 0.5rem",
                                  background: "var(--card-bg, rgba(255, 180, 0, 0.12))",
                                  borderRadius: "4px",
                                  maxWidth: "20rem",
                                }}
                              >
                                <strong>No encontramos el producto exacto</strong> que votó la audiencia con el criterio
                                completo: esta ficha es una <strong>coincidencia aproximada</strong> (criterio ampliado,
                                p. ej. solo marca o categoría).
                              </div>
                            ) : null}
                            {r.article ? (
                              <div className="muted small">
                                {r.article}
                                {r.brand || r.detail
                                  ? ` · ${[r.brand, r.detail].filter(Boolean).join(" · ")}`
                                  : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted" title="Falta indicar el ID de la ficha en Artículos">
                            Pendiente de asignar
                          </span>
                        )}
                      </td>
                      <td>
                        {r.trend_pct != null ? (
                          <>
                            <span title="Primer vs último mínimo en la ventana">{fmtPct(r.trend_pct)}</span>
                            <div className="muted small">{trendPhrase(r.trend_pct)}</div>
                            <div className="muted small">
                              {fmtMoney(r.first_min)} → {fmtMoney(r.last_min)}
                            </div>
                            <WindowRangeLine
                              w_min={r.w_min}
                              w_median={r.w_median}
                              w_max={r.w_max}
                              max_dod_drop_pct={r.max_dod_drop_pct}
                            />
                            <NarrativeBlock narrative={r.narrative} />
                          </>
                        ) : r.articleId != null ? (
                          <span className="muted small">Faltan al menos 2 días con dato en la ventana.</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.articleId != null ? (
                          <Link to={`/resumen/${r.articleId}`} state={resumenNavState}>
                            Resumen
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card block" style={{ marginTop: "1.5rem" }}>
            <h2>2) Otras fichas con precio a la baja (hasta 10)</h2>
            <p className="muted small">
              Orden: mayor caída relativa primero. Solo fichas habilitadas con al menos dos relevamientos en la
              ventana; excluidas las que ya están en la lista votada con ID configurado.
            </p>
            {data.topPriceDrops.length === 0 ? (
              <p className="muted">No hubo caídas en la ventana para otras fichas, o aún no hay datos suficientes.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Búsqueda</th>
                      <th>Tendencia y lectura</th>
                      <th>Mínimos</th>
                      <th>Resumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPriceDrops.map((r) => (
                      <tr key={r.article_id}>
                        <td>
                          <strong>#{r.article_id}</strong>
                          <div className="muted small">{r.article}</div>
                          {r.brand || r.detail ? (
                            <div className="muted small">{[r.brand, r.detail].filter(Boolean).join(" · ")}</div>
                          ) : null}
                        </td>
                        <td>
                          <strong>{fmtPct(r.trend_pct)}</strong>
                          <div className="muted small">{trendPhrase(r.trend_pct)}</div>
                          <WindowRangeLine
                            w_min={r.w_min}
                            w_median={r.w_median}
                            w_max={r.w_max}
                            max_dod_drop_pct={r.max_dod_drop_pct}
                          />
                          <NarrativeBlock narrative={r.narrative} />
                        </td>
                        <td className="muted small">
                          {fmtMoney(r.first_min)} → {fmtMoney(r.last_min)}
                          <div>{r.n_points} días con dato</div>
                        </td>
                        <td>
                          <Link to={`/resumen/${r.article_id}`} state={resumenNavState}>
                            Resumen
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
