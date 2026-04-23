import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../../api";
import { productScopeQueryString } from "../../productScopeUrl";
import type { PriceJumpsByNamePayload } from "../../types";

const DAY_OPTIONS = [
  { value: "10", label: "Últimos 10 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "60", label: "Últimos 60 días" },
];

function pctFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)} %`;
}

export function AnalysisPriceJumpsPage() {
  const [params, setParams] = useSearchParams();
  const nameFromUrl = params.get("name") ?? "";
  const daysFromUrl = params.get("days") ?? "30";
  const thresholdFromUrl = params.get("threshold_pct") ?? "15";

  const [name, setName] = useState(nameFromUrl);
  const [days, setDays] = useState(DAY_OPTIONS.some((o) => o.value === daysFromUrl) ? daysFromUrl : "30");
  const [thresholdPct, setThresholdPct] = useState(thresholdFromUrl);
  const [data, setData] = useState<PriceJumpsByNamePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(nameFromUrl);
    if (DAY_OPTIONS.some((o) => o.value === daysFromUrl)) setDays(daysFromUrl);
    setThresholdPct(thresholdFromUrl);
  }, [nameFromUrl, daysFromUrl, thresholdFromUrl]);

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
        const q = new URLSearchParams({
          name: nameFromUrl.trim(),
          days: daysFromUrl,
          threshold_pct: thresholdFromUrl,
        });
        const res = await fetchJson<PriceJumpsByNamePayload>(`/api/analysis/price-jumps-by-name?${q}`);
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
  }, [nameFromUrl, daysFromUrl, thresholdFromUrl]);

  function apply(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (name.trim().length >= 2) q.set("name", name.trim());
    q.set("days", days);
    const n = Number(thresholdPct);
    if (Number.isFinite(n)) q.set("threshold_pct", String(Math.round(n)));
    setParams(q);
  }

  return (
    <div>
      <h2>Alertas de salto de precio (día a día)</h2>
      <p className="muted small">
        Te muestra publicaciones (agrupadas por el mismo texto de título que en el tablero) donde el
        precio más bajo del día “pegó un salto” fuerte respecto al día anterior con dato. Sirve para
        detectar ofertas flash, errores de scrape, cambios de vendedor o listados que se movieron mucho en
        poco tiempo, y entrar a la ficha o al informe con un clic.
      </p>
      <p className="muted small">
        Solo aparecen casos cuyo mayor salto relativo día a día en el período supera el umbral que elijas.
        Misma ventana temporal y misma regla de título que en estabilidad de precios.
      </p>
      <p className="muted small">
        <strong>Mismo producto acá sí usa el título del listado</strong> (<code>results.title</code>), pero{" "}
        <strong>no exige que el texto sea idéntico carácter por carácter</strong>: se normaliza (todo en
        minúsculas y espacios consecutivos unificados a un solo espacio, sin espacios al borde). Así, dos
        publicaciones con el mismo título salvo mayúsculas o espacios extra cuentan como la misma línea de
        producto, igual que cuando filtrás por producto en el tablero.
      </p>

      <details className="card block" style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Cómo se calcula (para administradores)
        </summary>
        <div className="muted small" style={{ marginTop: "0.75rem" }}>
          <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>
              <strong>Fichas candidatas:</strong> habilitadas cuyo <em>artículo</em> contiene el texto
              buscado (coincidencia parcial, sin distinguir mayúsculas).
            </li>
            <li>
              <strong>Por día y ficha:</strong> se usa la corrida de scrape más reciente de ese día
              calendario; solo precios positivos.
            </li>
            <li>
              <strong>Agrupación por producto:</strong> los resultados se agrupan por{" "}
              <strong>título de publicación normalizado</strong>:{" "}
              <code>lower</code>, colapsar bloques de espacios a uno solo y <code>trim</code> (misma
              expresión SQL que al filtrar por producto en el tablero). No es igualdad exacta del texto
              crudo tal como viene de Mercado Libre. Se descartan filas sin título.
            </li>
            <li>
              <strong>Mínimo diario por título:</strong> para cada día con datos, el mínimo de precio entre
              todas las publicaciones de ese título (sumando todas las fichas candidatas).
            </li>
            <li>
              <strong>Salto entre días consecutivos con dato:</strong> ordenados por fecha, para cada par de
              días seguidos con mínimo <code>prev</code> y <code>curr</code>:{" "}
              <code>|curr − prev| / prev</code> (valor relativo, sin signo).
            </li>
            <li>
              <strong>Por título en la ventana:</strong> se guarda el <strong>máximo</strong> de esos saltos.
              La fila aparece solo si ese máximo es mayor o igual al umbral configurado (por defecto 15 %).
              Las columnas “desde / hasta” corresponden al par de días donde ocurrió ese máximo (si hay
              empate en magnitud, se prioriza el salto con fecha de fin más reciente).
            </li>
          </ol>
        </div>
      </details>

      <form className="card filters" onSubmit={apply} style={{ marginTop: "1rem" }}>
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
          <label>
            Umbral de salto (%)
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={thresholdPct}
              onChange={(e) => setThresholdPct(e.target.value)}
            />
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
            «{data.name}» · {data.days} días · umbral {data.threshold_pct} % · {data.count} títulos con
            salto máximo ≥ umbral (tope 120 filas).
          </p>
          {data.rows.length === 0 ? (
            <p className="muted">
              No hay títulos que superen el umbral en ese período (o no hay dos días consecutivos con
              precio).
            </p>
          ) : (
            <div className="table-wrap card">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Título del listado</th>
                    <th>Fichas</th>
                    <th>Salto máx.</th>
                    <th>Día anterior</th>
                    <th>Día siguiente</th>
                    <th>Enlaces</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const scope = productScopeQueryString(r.product_title, null);
                    const base = `/articulos/${r.primary_article_id}`;
                    return (
                      <tr key={`${r.product_title}-${r.day_from}-${r.day_to}`}>
                        <td className="cell-title-multiline">{r.product_title}</td>
                        <td>{r.n_articles}</td>
                        <td title="Máximo entre días consecutivos con dato en la ventana">{pctFmt(r.max_jump_pct)}</td>
                        <td>{r.day_from}</td>
                        <td>{r.day_to}</td>
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
          )}
        </>
      )}
    </div>
  );
}
