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
  if (pct < -0.005) {
    return "En la ventana, en esa misma tienda (la del listado más barato el primer día), el precio bajó respecto al inicio.";
  }
  if (pct > 0.005) {
    return "En la ventana, en esa misma tienda (la del listado más barato el primer día), el precio subió respecto al inicio.";
  }
  return "En esa misma tienda, el precio se mantuvo bastante estable en el período.";
}

function MarketOnlyBecauseAnchorStaleNote() {
  return (
    <p className="muted small" style={{ maxWidth: "22rem", marginTop: "0.35rem" }}>
      La tienda más barata al <strong>primer día</strong> no tiene precios del mismo producto en los{" "}
      <strong>últimos 7 días</strong> (respecto del último relevamiento entre todas las tiendas). Mostramos solo{" "}
      <strong>todas las tiendas</strong>; la fila por tienda ancla sería engañosa.
    </p>
  );
}

function trendSellerCaption(
  seller: string | null | undefined,
  anchorSource?: string | null,
  _anchorFirstDayRank?: number | null,
): string | null {
  if (seller == null || !String(seller).trim()) return null;
  const s = String(seller).trim();
  const tail =
    " Si otra tienda bajó más el mismo producto, eso se ve en «Todas las tiendas» debajo.";
  if (s.toLowerCase() === "(sin tienda)") {
    if (anchorSource === "last_run_cheapest") {
      return `Ancla sin nombre de tienda en el dato, tomada del último relevamiento entre todas las tiendas (no hubo candidato del primer día con precio reciente).${tail}`;
    }
    return `Para la ancla usamos publicaciones del primer día sin nombre de tienda en el scrape (mismo producto).${tail}`;
  }
  if (anchorSource === "first_day_alt") {
    return `Tendencia para «${s}»: es la opción más barata el primer día de la ventana entre las tiendas que sí tienen precio del mismo producto en los últimos 7 días (respecto del último relevamiento general); otras más baratas ese día no actualizaron.${tail}`;
  }
  if (anchorSource === "last_run_cheapest") {
    return `Tendencia para «${s}»: listado más barato en el último relevamiento entre todas las tiendas; ninguna tienda del primer día tenía precio reciente del mismo producto.${tail}`;
  }
  return `Tendencia principal solo para «${s}» (listado más barato el primer día).${tail}`;
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
      En la ventana, mínimos diarios de <strong>esa misma tienda</strong>: bajo {fmtMoney(w_min)} · mediana{" "}
      {fmtMoney(w_median)} · alto {fmtMoney(w_max)}
      {max_dod_drop_pct != null && max_dod_drop_pct > 0.02 ? (
        <span> · mayor caída día a día ~{fmtPct(max_dod_drop_pct)}</span>
      ) : null}
    </div>
  );
}

/** Mejor precio por día entre cualquier vendedor (mismo producto / clúster): puede haber bajado otra tienda. */
function MarketAllStoresBlock(props: {
  trend_pct: number | null | undefined;
  first_min: number | null | undefined;
  last_min: number | null | undefined;
  w_min: number | null | undefined;
  w_median: number | null | undefined;
  w_max: number | null | undefined;
}) {
  const { trend_pct, first_min, last_min, w_min, w_median, w_max } = props;
  if (
    first_min == null ||
    last_min == null ||
    !Number.isFinite(first_min) ||
    !Number.isFinite(last_min) ||
    trend_pct == null ||
    !Number.isFinite(trend_pct)
  ) {
    return null;
  }
  return (
    <div
      className="muted small"
      style={{
        marginTop: "0.45rem",
        paddingTop: "0.4rem",
        borderTop: "1px solid var(--border, rgba(0, 0, 0, 0.1))",
        maxWidth: "22rem",
      }}
    >
      <strong>Todas las tiendas</strong> — precio más bajo entre <em>cualquier</em> vendedor cada día (mismo producto): si
      otra tienda ganó el mínimo, cuenta acá. {fmtPct(trend_pct)} · {fmtMoney(first_min)} → {fmtMoney(last_min)}
      {w_min != null && Number.isFinite(w_min) ? (
        <>
          {" "}
          · rango diario en el período: bajo {fmtMoney(w_min)} · mediana {fmtMoney(w_median)} · alto {fmtMoney(w_max)}
        </>
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
            <p className="muted small" style={{ maxWidth: "50rem", marginTop: "0.65rem" }}>
              Por ficha usamos el <strong>mismo producto</strong> que en el tablero (clúster) y una{" "}
              <strong>tienda ancla</strong>: la del listado más barato el <em>primer</em> día con dato. El{" "}
              <strong>porcentaje principal</strong> y la tabla de mínimos de <strong>esa misma tienda</strong> no mezclan
              otras tiendas que ya existían a otro precio (evita confundir “cambió el vendedor” con “bajó el precio”).
              Cuando <strong>otra tienda</strong> publica más barato, <strong>sí lo mostramos</strong> en la segunda
              lectura de cada fila (<strong>Todas las tiendas</strong>): ahí el mínimo del día es entre{" "}
              <em>cualquier</em> vendedor del mismo producto y la tendencia refleja ese mejor precio global. El
              criterio de &quot;mismo producto&quot; usa la misma lógica que el tablero: se mira una ventana de hasta{" "}
              <strong>365 días</strong> para fijar el producto de referencia; los porcentajes y flechas siguen usando
              solo los <strong>N días</strong> que elegís arriba.
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
          Mostramos <strong>dos lecturas</strong>: la tienda del listado más barato al <em>primer</em> día (tendencia
          honesta, sin mezclar vendedores) y, aparte, el <strong>mejor precio entre todas las tiendas</strong> del mismo
          producto por día, por si otra tienda terminó más barata.
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
              La fila principal sigue a <strong>una</strong> tienda: la más barata el primer día que sigue publicando el
              mismo producto en los <strong>últimos 7 días</strong> (respecto del último relevamiento general); si ninguna
              califica, usamos la del listado más barato en ese último relevamiento. Si tampoco alcanza para una serie
              clara, solo mostramos <strong>todas las tiendas</strong>. Debajo va el mejor precio por día entre cualquier
              vendedor (mismo producto).
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
                        {r.trend_pct != null && r.anchor_fresh !== false ? (
                          <>
                            <span title="Primer vs último mínimo en la ventana">{fmtPct(r.trend_pct)}</span>
                            <div className="muted small">{trendPhrase(r.trend_pct)}</div>
                            {(() => {
                              const c = trendSellerCaption(r.trend_seller, r.anchor_source, r.anchor_first_day_rank);
                              return c ? <div className="muted small">{c}</div> : null;
                            })()}
                            <div className="muted small">
                              {fmtMoney(r.first_min)} → {fmtMoney(r.last_min)}
                            </div>
                            <WindowRangeLine
                              w_min={r.w_min}
                              w_median={r.w_median}
                              w_max={r.w_max}
                              max_dod_drop_pct={r.max_dod_drop_pct}
                            />
                            <MarketAllStoresBlock
                              trend_pct={r.market_trend_pct}
                              first_min={r.market_first_min}
                              last_min={r.market_last_min}
                              w_min={r.market_w_min}
                              w_median={r.market_w_median}
                              w_max={r.market_w_max}
                            />
                            <NarrativeBlock narrative={r.narrative} />
                          </>
                        ) : r.articleId != null && r.linked && r.market_last_min != null ? (
                          <>
                            <MarketOnlyBecauseAnchorStaleNote />
                            <MarketAllStoresBlock
                              trend_pct={r.market_trend_pct}
                              first_min={r.market_first_min}
                              last_min={r.market_last_min}
                              w_min={r.market_w_min}
                              w_median={r.market_w_median}
                              w_max={r.market_w_max}
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
                          <Link to={`/resumen/${r.articleId}?hotSaleDays=${days}`} state={resumenNavState}>
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
              Orden según la <strong>caída en la tienda del primer día</strong> (como arriba). En cada fila también ves
              la lectura entre <strong>todas las tiendas</strong> del mismo producto.
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
                          {(() => {
                            const c = trendSellerCaption(r.trend_seller, r.anchor_source, r.anchor_first_day_rank);
                            return c ? <div className="muted small">{c}</div> : null;
                          })()}
                          <WindowRangeLine
                            w_min={r.w_min}
                            w_median={r.w_median}
                            w_max={r.w_max}
                            max_dod_drop_pct={r.max_dod_drop_pct}
                          />
                          <MarketAllStoresBlock
                            trend_pct={r.market_trend_pct}
                            first_min={r.market_first_min}
                            last_min={r.market_last_min}
                            w_min={r.market_w_min}
                            w_median={r.market_w_median}
                            w_max={r.market_w_max}
                          />
                          <NarrativeBlock narrative={r.narrative} />
                        </td>
                        <td className="muted small">
                          {fmtMoney(r.first_min)} → {fmtMoney(r.last_min)}
                          <div>{r.n_points} días con dato</div>
                        </td>
                        <td>
                          <Link to={`/resumen/${r.article_id}?hotSaleDays=${days}`} state={resumenNavState}>
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
