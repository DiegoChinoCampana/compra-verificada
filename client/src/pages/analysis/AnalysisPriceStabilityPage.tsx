import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "../../api";
import { productScopeFromGroupKey } from "../../productScopeUrl";
import { AnalysisProductCell, analysisProductTooltipTitle } from "./AnalysisProductCell";
import { AnalysisTechnicalHelp } from "./AnalysisTechnicalHelp";
import type {
  PriceStabilityByNamePayload,
  PriceStabilityDailySeries,
  PriceStabilityRow,
} from "../../types";

const DAY_OPTIONS = [
  { value: "10", label: "Últimos 10 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "60", label: "Últimos 60 días" },
];

function pctFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)} %`;
}

function moneyFmt(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function rowChartLabel(r: PriceStabilityRow): string {
  const title = (r.sample_listing_title?.trim() || r.product_title).trim();
  const gk = r.group_key.trim();
  let base: string;
  if (gk.startsWith("cluster:")) {
    const k = gk.length > 18 ? `${gk.slice(0, 16)}…` : gk;
    const t = title.length > 24 ? `${title.slice(0, 22)}…` : title;
    base = `${k} · ${t}`;
  } else {
    base = title.length > 44 ? `${title.slice(0, 42)}…` : title;
  }
  if (r.seller && r.seller.toLowerCase() !== "(sin tienda)") {
    const sv = r.seller.length > 22 ? `${r.seller.slice(0, 20)}…` : r.seller;
    return `${base} · ${sv}`;
  }
  return base;
}

const LINE_SERIES_CAP = 25;

const LINE_PALETTE = [
  "#0b3d52",
  "#1a6b38",
  "#0d5c52",
  "#2d6a4f",
  "#1b4332",
  "#52796f",
  "#047857",
  "#0e7490",
  "#155e75",
  "#115e59",
  "#166534",
  "#14532d",
  "#134e4a",
  "#0f766e",
  "#0f172a",
  "#365314",
  "#3f6212",
  "#57534e",
  "#0369a1",
  "#075985",
  "#0c4a6e",
  "#164e63",
  "#155e75",
  "#0e7490",
  "#0f766e",
];

type ChartView = "bars" | "daily";

function mergeDailySeries(seriesList: PriceStabilityDailySeries[]): Record<string, string | number | null>[] {
  const days = new Set<string>();
  for (const s of seriesList) {
    for (const p of s.points) days.add(p.day);
  }
  const sorted = [...days].sort();
  const mapBySeries = new Map<number, Map<string, number>>();
  for (const s of seriesList) {
    mapBySeries.set(s.series_id, new Map(s.points.map((p) => [p.day, p.min_price])));
  }
  return sorted.map((day) => {
    const row: Record<string, string | number | null> = {
      day,
      dayLabel: new Date(`${day}T12:00:00`).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
      }),
    };
    for (const s of seriesList) {
      const v = mapBySeries.get(s.series_id)?.get(day);
      row[`s_${s.series_id}`] = v !== undefined ? v : null;
    }
    return row;
  });
}

type SeriesMeta = {
  primaryArticleId: number;
  productTitle: string;
  sampleListingTitle: string;
  groupKey: string;
  seller: string;
};

type DailyTooltipPayloadItem = {
  dataKey?: string | number;
  name?: string;
  value?: string | number | null;
  color?: string;
  payload?: Record<string, string | number | null>;
};

/** Orden fijo (mismo que líneas / tabla) y enlaces por título de producto. */
function DailyMinEvolutionTooltip({
  active,
  payload,
  seriesOrder,
  seriesMeta,
}: {
  active?: boolean;
  payload?: readonly DailyTooltipPayloadItem[];
  seriesOrder: number[];
  seriesMeta: Map<number, SeriesMeta>;
}) {
  if (!active || !payload?.length) return null;

  const byDataKey = new Map<string, DailyTooltipPayloadItem>();
  for (const item of payload) {
    if (item.dataKey != null) byDataKey.set(String(item.dataKey), item);
  }

  const row0 = payload[0]?.payload;
  const day = row0?.day;
  const titleLabel =
    typeof day === "string"
      ? new Date(`${day}T12:00:00`).toLocaleDateString("es-AR", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";

  return (
    <div className="chart-tooltip-daily">
      <p className="chart-tooltip-daily__label">{titleLabel}</p>
      <ul className="chart-tooltip-daily__list">
        {seriesOrder.map((seriesId) => {
          const item = byDataKey.get(`s_${seriesId}`);
          const raw = item?.value;
          const n = typeof raw === "number" ? raw : raw != null && raw !== "" ? Number(raw) : NaN;
          const priceStr = Number.isFinite(n) ? moneyFmt(n) : "—";
          const meta = seriesMeta.get(seriesId);
          const scope = meta ? productScopeFromGroupKey(meta.groupKey, meta.seller) : "";
          const base = meta ? `/articulos/${meta.primaryArticleId}` : "";

          return (
            <li key={seriesId} className="chart-tooltip-daily__row">
              <span
                className="chart-tooltip-daily__swatch"
                style={{ background: item?.color ?? "var(--border)" }}
                aria-hidden
              />
              <div className="chart-tooltip-daily__main">
                {meta ? (
                  <div
                    className="chart-tooltip-daily__title"
                    title={analysisProductTooltipTitle({
                      group_key: meta.groupKey,
                      product_title: meta.productTitle,
                      sample_listing_title: meta.sampleListingTitle,
                    })}
                  >
                    <AnalysisProductCell
                      row={{
                        group_key: meta.groupKey,
                        product_title: meta.productTitle,
                        sample_listing_title: meta.sampleListingTitle,
                      }}
                    />
                  </div>
                ) : (
                  <span className="chart-tooltip-daily__title">{item?.name ?? `#${seriesId}`}</span>
                )}
                {meta ? (
                  <span className="chart-tooltip-daily__links">
                    <Link
                      to={`${base}${scope}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      Tablero
                    </Link>
                    <Link
                      to={`${base}/listados${scope}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      Listados
                    </Link>
                    <Link
                      to={`/informe/${meta.primaryArticleId}${scope}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      Informe
                    </Link>
                  </span>
                ) : null}
              </div>
              <span className="chart-tooltip-daily__price">{priceStr}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AnalysisPriceStabilityPage() {
  const [params, setParams] = useSearchParams();
  const nameFromUrl = params.get("name") ?? "";
  const daysFromUrl = params.get("days") ?? "30";
  const chartView: ChartView = params.get("view") === "daily" ? "daily" : "bars";

  const [name, setName] = useState(nameFromUrl);
  const [days, setDays] = useState(DAY_OPTIONS.some((o) => o.value === daysFromUrl) ? daysFromUrl : "30");
  const [data, setData] = useState<PriceStabilityByNamePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(nameFromUrl);
    if (DAY_OPTIONS.some((o) => o.value === daysFromUrl)) setDays(daysFromUrl);
  }, [nameFromUrl, daysFromUrl]);

  useEffect(() => {
    if (nameFromUrl.trim().length < 2) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ name: nameFromUrl.trim(), days: daysFromUrl });
        const res = await fetchJson<PriceStabilityByNamePayload>(`/api/analysis/price-stability-by-name?${q}`);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nameFromUrl, daysFromUrl]);

  function apply(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (name.trim().length >= 2) q.set("name", name.trim());
    q.set("days", days);
    if (params.get("view") === "daily") q.set("view", "daily");
    setParams(q);
  }

  function selectChartView(next: ChartView) {
    const q = new URLSearchParams(params);
    if (nameFromUrl.trim().length >= 2) q.set("name", nameFromUrl.trim());
    q.set("days", daysFromUrl);
    if (next === "daily") q.set("view", "daily");
    else q.delete("view");
    setParams(q, { replace: true });
  }

  const chartData = useMemo(() => {
    if (!data?.rows.length) return [];
    return data.rows.map((r) => ({
      seriesId: r.series_id,
      label: rowChartLabel(r),
      valor_inicial: r.first_day_min,
      valor_ultimo: r.last_day_min,
    }));
  }, [data]);

  const chartHeight = useMemo(() => {
    const n = chartData.length;
    if (n === 0) return 0;
    return Math.min(720, Math.max(220, 28 * n + 120));
  }, [chartData.length]);

  const dailySeriesForChart = useMemo(() => {
    const list = data?.daily_by_series ?? [];
    return list.slice(0, LINE_SERIES_CAP);
  }, [data]);

  const dailyLineData = useMemo(() => mergeDailySeries(dailySeriesForChart), [dailySeriesForChart]);

  const seriesLabel = useMemo(() => {
    const m = new Map<number, string>();
    if (!data?.rows) return m;
    for (const r of data.rows) m.set(r.series_id, rowChartLabel(r));
    return m;
  }, [data]);

  const seriesMetaById = useMemo(() => {
    const m = new Map<number, SeriesMeta>();
    if (!data?.rows) return m;
    for (const r of data.rows) {
      m.set(r.series_id, {
        primaryArticleId: r.primary_article_id,
        productTitle: r.product_title,
        sampleListingTitle: r.sample_listing_title,
        groupKey: r.group_key,
        seller: r.seller,
      });
    }
    return m;
  }, [data]);

  const dailySeriesOrder = useMemo(
    () => dailySeriesForChart.map((s) => s.series_id),
    [dailySeriesForChart],
  );

  const dailyTruncated =
    !!data && (data.daily_by_series?.length ?? 0) > LINE_SERIES_CAP;

  return (
    <div>
      <h2>Estabilidad de precios (mismo nombre de artículo)</h2>
      <p className="muted small">
        Buscá por texto en el <strong>nombre de la ficha</strong> (ej. <strong>Colchón</strong>) y un
        período. Se unen los resultados scrapeados de <strong>todas las fichas</strong> que coinciden
        y se agrupan por <strong>clave de producto semántica</strong> (<code>product_key</code> del batch de
        clustering) cuando existe; si no, por <strong>título de publicación normalizado</strong> (mismo
        criterio que el tablero). Cada fila es un producto concreto en una <strong>tienda</strong> (
        <code>results.seller</code> normalizado), aunque el mismo cluster aparezca en varias fichas u otros
        vendedores. Orden: primero los que menos variaron o bajaron de precio, con menos oscilación entre días.
      </p>

      <AnalysisTechnicalHelp>
        <p>
          <strong>Qué mirás en la base.</strong> Primero se filtran fichas en la tabla{" "}
          <code>articles</code>: solo <code>enabled = true</code> y el texto que escribís se busca en el
          campo <code>articles.article</code> con <code>ILIKE</code> (contiene, sin importar mayúsculas).
          No se usa <code>brand</code> ni <code>detail</code> en este paso. Se toman hasta 250{" "}
          <code>articles.id</code> candidatos.
        </p>
        <p>
          Después se traen los listados scrapeados de la tabla <code>results</code>, uniendo{" "}
          <code>results.search_id</code> con esos ids (<code>search_id</code> apunta a la ficha). Las
          fechas vienen de <code>scrape_runs</code> vía <code>results.scrape_run_id</code>, acotadas al
          período (10 / 30 / 60 días).
        </p>
        <p>
          Para agrupar “el mismo producto” se usa <code>COALESCE(product_key, título normalizado)</code> en{" "}
          <code>results</code>: si hay clustering, gana <code>product_key</code> (p. ej.{" "}
          <code>cluster:…</code>); si no, el título de publicación normalizado como antes. Esa clave puede
          juntar filas de <strong>varias fichas</strong> distintas.
        </p>
        <p>
          Por cada combinación <strong>clave de producto + tienda</strong>, el precio del día es el{" "}
          <strong>mínimo</strong> entre las publicaciones de <em>esa tienda</em> en la corrida elegida. Así los
          saltos no mezclan ofertas de vendedores distintos. Solo entran series con al menos 2 días con dato en
          la ventana. El orden del gráfico prioriza poca variación o baja de precio y baja oscilación relativa
          entre días.
        </p>
      </AnalysisTechnicalHelp>

      <form className="card filters" onSubmit={apply}>
        <div className="field-grid">
          <label className="field-span-2">
            Nombre de artículo
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Colchón, Heladera…"
              minLength={2}
              required
            />
          </label>
          <label>
            Período
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit">Analizar</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Analizando…</p>}

      {!loading && nameFromUrl.trim().length < 2 && (
        <p className="muted">Ingresá al menos 2 caracteres del nombre y pulsá Analizar.</p>
      )}

      {!loading && data && (
        <>
          <p className="muted small" style={{ margin: "0.75rem 0" }}>
            «{data.name}» ·             ventana {data.days} días · {data.count} series (producto + tienda) con al menos 2 días
            de precio en el período (corrida más reciente por día y ficha).
          </p>
          {data.rows.length === 0 ? (
            <p className="muted">
              No hay productos con datos suficientes para ese criterio (revisá que haya resultados con título
              y precio en la ventana).
            </p>
          ) : (
            <>
              <nav className="subnav" aria-label="Vista del gráfico" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className={chartView === "bars" ? "subnavlink subnavlink--active" : "subnavlink"}
                  onClick={() => selectChartView("bars")}
                >
                  Barras (inicial vs último)
                </button>
                <button
                  type="button"
                  className={chartView === "daily" ? "subnavlink subnavlink--active" : "subnavlink"}
                  onClick={() => selectChartView("daily")}
                >
                  Evolución día a día
                </button>
              </nav>

              {chartView === "bars" ? (
                <section className="card block" aria-labelledby="price-stability-chart-title">
                  <h3 id="price-stability-chart-title" style={{ marginTop: 0 }}>
                    Comparación visual
                  </h3>
                  <p className="muted small">
                    Mínimo del <strong>primer día</strong> con scrape en la ventana frente al mínimo del{" "}
                    <strong>último día</strong> con datos (mismo criterio que la tabla). Escala en pesos
                    argentinos.
                  </p>
                  <div className="chart-box" style={{ minHeight: chartHeight }}>
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <BarChart
                        layout="vertical"
                        data={chartData}
                        margin={{ top: 8, right: 28, left: 4, bottom: 8 }}
                        barCategoryGap="18%"
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={(v) =>
                            typeof v === "number"
                              ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 })
                              : String(v)
                          }
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={260}
                          tick={{ fontSize: 10 }}
                          interval={0}
                        />
                        <Tooltip
                          formatter={(value) => {
                            const n = typeof value === "number" ? value : Number(value);
                            return Number.isFinite(n) ? moneyFmt(n) : "—";
                          }}
                          labelFormatter={(l) => String(l)}
                        />
                        <Legend wrapperStyle={{ fontSize: "0.85rem" }} />
                        <Bar
                          dataKey="valor_inicial"
                          name="Valor inicial registrado"
                          fill="#1e3a8a"
                          radius={[0, 4, 4, 0]}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="valor_ultimo"
                          name="Valor último registrado"
                          fill="#c2410c"
                          radius={[0, 4, 4, 0]}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              ) : (
                <section className="card block" aria-labelledby="price-stability-daily-title">
                  <h3 id="price-stability-daily-title" style={{ marginTop: 0 }}>
                    Evolución del mínimo diario
                  </h3>
                  <p className="muted small">
                    Por cada día calendario se muestra el <strong>mínimo de precio</strong> entre
                    publicaciones de ese <strong>mismo producto y misma tienda</strong>. Una línea por cada
                    fila del listado.
                  </p>
                  {dailyTruncated && (
                    <p className="warn" style={{ marginTop: 0 }}>
                      Hay más de {LINE_SERIES_CAP} títulos: en este gráfico se muestran las primeras{" "}
                      {LINE_SERIES_CAP} filas del listado (mismo orden que la tabla). El resto sigue en la
                      tabla y en la vista de barras.
                    </p>
                  )}
                  <div className="chart-box" style={{ minHeight: 360 }}>
                    <ResponsiveContainer width="100%" height={360}>
                      <LineChart data={dailyLineData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) =>
                            typeof v === "number"
                              ? v.toLocaleString("es-AR", { maximumFractionDigits: 0 })
                              : String(v)
                          }
                        />
                        <Tooltip
                          isAnimationActive={false}
                          wrapperStyle={{ zIndex: 20 }}
                          content={({ active, payload }) => (
                            <DailyMinEvolutionTooltip
                              active={active}
                              payload={payload as readonly DailyTooltipPayloadItem[] | undefined}
                              seriesOrder={dailySeriesOrder}
                              seriesMeta={seriesMetaById}
                            />
                          )}
                        />
                        <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                        {dailySeriesForChart.map((s, idx) => (
                          <Line
                            key={s.series_id}
                            type="monotone"
                            dataKey={`s_${s.series_id}`}
                            name={seriesLabel.get(s.series_id) ?? `#${s.series_id}`}
                            stroke={LINE_PALETTE[idx % LINE_PALETTE.length]}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              <div className="table-wrap card">
              <table className="table table--dense table--col-help table--price-stability">
                <thead>
                  <tr>
                    <th title="Vendedor/tienda normalizado; el mínimo diario es solo dentro de esta tienda.">
                      Tienda
                    </th>
                    <th title="Si hay clustering, se muestra la product_key y debajo un título de listado representativo; si no, solo el título normalizado.">
                      Producto
                    </th>
                    <th title="Cantidad de fichas de búsqueda distintas (artículos habilitados) en las que apareció este título en el período.">
                      Fichas
                    </th>
                    <th title="Cantidad de días calendario distintos con al menos una corrida válida (por día y ficha se usa la corrida más reciente), con precio para este título.">
                      Días con dato
                    </th>
                    <th title="Mínimo precio entre publicaciones de este título el día de la primera corrida con datos en la ventana. Punto de partida para la tendencia.">
                      Valor inicial registrado
                    </th>
                    <th title="Mínimo precio el día de la última corrida con datos en la ventana. Se compara contra el valor inicial en Tendencia.">
                      Valor último registrado
                    </th>
                    <th title="Cambio relativo del mínimo del último día respecto al del primer día: (último − inicial) / inicial. Negativo = bajó de precio, positivo = subió.">
                      Tendencia
                    </th>
                    <th title="Oscilación del mínimo día a día: (máximo de los mínimos diarios − mínimo de los mínimos diarios) dividido el promedio de esos mínimos. Valores más bajos indican menos salto entre días.">
                      Rango / prom.
                    </th>
                    <th title="Coeficiente de variación de los mínimos diarios (desvío estándar / promedio). Mide qué tan dispersos estuvieron los mínimos día a día; más bajo suele significar precio más estable.">
                      CV diario
                    </th>
                    <th title="Abre tablero, listados o informe en una ficha, filtrado por la misma clave de producto (product_key o título normalizado).">
                      Enlaces
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const scope = productScopeFromGroupKey(r.group_key, r.seller);
                    const base = `/articulos/${r.primary_article_id}`;
                    return (
                    <tr key={`${r.series_id}-${r.seller}`}>
                      <td className="muted small">{r.seller}</td>
                      <td>
                        <AnalysisProductCell
                          row={{
                            group_key: r.group_key,
                            product_title: r.product_title,
                            sample_listing_title: r.sample_listing_title,
                          }}
                        />
                      </td>
                      <td>{r.n_articles}</td>
                      <td>{r.n_days}</td>
                      <td>
                        {r.first_day_min.toLocaleString("es-AR", {
                          style: "currency",
                          currency: "ARS",
                        })}
                      </td>
                      <td>
                        {r.last_day_min.toLocaleString("es-AR", {
                          style: "currency",
                          currency: "ARS",
                        })}
                      </td>
                      <td title="Último vs primer día con precio en la ventana">{pctFmt(r.trend_pct)}</td>
                      <td title="(máx − mín) diarios / promedio en el período">{pctFmt(r.range_pct)}</td>
                      <td title="Desvío típico de mínimos diarios / media">{pctFmt(r.cv_daily_mins)}</td>
                      <td className="actions">
                        <Link to={`${base}${scope}`}>Tablero</Link>
                        <Link to={`${base}/listados${scope}`}>Listados</Link>
                        <Link to={`/informe/${r.primary_article_id}${scope}`}>Informe</Link>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
