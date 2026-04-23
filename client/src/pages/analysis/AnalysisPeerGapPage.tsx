import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../../api";
import type { PeerGapByNamePayload } from "../../types";

function pctFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)} %`;
}

export function AnalysisPeerGapPage() {
  const [params, setParams] = useSearchParams();
  const nameFromUrl = params.get("name") ?? "";

  const [name, setName] = useState(nameFromUrl);
  const [data, setData] = useState<PeerGapByNamePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(nameFromUrl);
  }, [nameFromUrl]);

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
        const q = new URLSearchParams({ name: nameFromUrl.trim() });
        const res = await fetchJson<PeerGapByNamePayload>(`/api/analysis/peer-gap-by-name?${q}`);
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
  }, [nameFromUrl]);

  function apply(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (name.trim().length >= 2) q.set("name", name.trim());
    setParams(q);
  }

  return (
    <div>
      <h2>Brecha vs peers (mismo artículo y detalle)</h2>
      <p className="muted small">
        Te ayuda a ver, entre búsquedas que vos configuraste como comparables (mismo nombre de artículo y
        mismo detalle en la ficha), si alguna marca está cotizando muy por encima o muy por debajo del
        “centro” del mercado según la última corrida. Sirve para priorizar revisiones de precio o detectar
        fichas desalineadas respecto al resto del grupo.
      </p>
      <p className="muted small">
        Compará el precio de referencia de cada ficha habilitada contra la{" "}
        <strong>mediana</strong> de otras marcas del mismo grupo. Orden: mayor magnitud de brecha primero.
      </p>
      <p className="muted small">
        <strong>Mismo “producto” acá no es el título de Mercado Libre.</strong> El agrupamiento usa solo los
        textos de la ficha: <em>artículo</em> y <em>detalle</em>, iguales salvo mayúsculas/minúsculas y
        espacios al inicio o al final. Si dos fichas tienen distinto detalle o distinto artículo
        normalizado, no entran en el mismo grupo aunque en el listado aparezcan publicaciones con título
        parecido.
      </p>

      <details className="card block" style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Cómo se calcula (para administradores)
        </summary>
        <div className="muted small" style={{ marginTop: "0.75rem" }}>
          <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>
              <strong>Candidatas:</strong> fichas habilitadas cuyo campo <em>artículo</em> contiene el
              texto buscado (coincidencia parcial, sin distinguir mayúsculas).
            </li>
            <li>
              <strong>Grupo peer:</strong> todas las fichas habilitadas con el mismo artículo y el mismo
              detalle de la <strong>tabla de fichas</strong> (no el <code>title</code> de{" "}
              <code>results</code>), comparando cadenas normalizadas (<code>lower(trim(·))</code>; si no hay
              detalle se trata como cadena vacía). Incluye la propia ficha y el resto del grupo.
            </li>
            <li>
              <strong>Precio de referencia por ficha:</strong> en la corrida de scrape más reciente (por
              fecha de ejecución), el <strong>mínimo</strong> de precio entre los resultados de esa corrida,
              descartando precios nulos o no positivos.
            </li>
            <li>
              <strong>Mediana de peers:</strong> percentil 50 (<code>percentile_cont(0.5)</code>) de esos
              mínimos en <strong>otras</strong> fichas del mismo grupo (mismo artículo + detalle, distinto{" "}
              <code>id</code>). Si no hay ninguna otra ficha con precio válido, la mediana queda vacía.
            </li>
            <li>
              <strong>Brecha %:</strong>{" "}
              <code>(mi_ref_min − mediana_peers) / mediana_peers</code>. Positivo: esta ficha quedó por
              encima de la mediana del grupo; negativo: por debajo.
            </li>
          </ol>
        </div>
      </details>

      <form className="card filters" onSubmit={apply} style={{ marginTop: "1rem" }}>
        <div className="field-grid">
          <label className="field-span-2">
            Texto en nombre de artículo
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Heladera, Colchón…"
              minLength={2}
              required
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
        <p className="muted">Ingresá al menos 2 caracteres y pulsá Analizar.</p>
      )}

      {!loading && data && (
        <>
          <p className="muted small" style={{ margin: "0.75rem 0" }}>
            «{data.name}» · {data.count} fichas en el listado (tope del servidor: 150 filas ordenadas).
          </p>
          {data.rows.length === 0 ? (
            <p className="muted">No hay fichas candidatas o falta precio en la última corrida.</p>
          ) : (
            <div className="table-wrap card">
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>Ficha</th>
                    <th>Marca</th>
                    <th>Detalle</th>
                    <th>Ref. (última corrida)</th>
                    <th>Mediana peers</th>
                    <th>Brecha vs mediana</th>
                    <th>Enlaces</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-title-multiline">{r.article}</td>
                      <td>{r.brand ?? "—"}</td>
                      <td className="muted">{r.detail?.trim() ? r.detail : "—"}</td>
                      <td>
                        {r.my_ref_min.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                      </td>
                      <td>
                        {r.peer_median != null && Number.isFinite(r.peer_median)
                          ? r.peer_median.toLocaleString("es-AR", {
                              style: "currency",
                              currency: "ARS",
                            })
                          : "—"}
                      </td>
                      <td title="(ref. propia − mediana peers) / mediana peers">{pctFmt(r.gap_vs_peer_median_pct)}</td>
                      <td className="actions">
                        <Link to={`/articulos/${r.id}`}>Tablero</Link>
                        <Link to={`/articulos/${r.id}/listados`}>Listados</Link>
                        <Link to={`/informe/${r.id}`}>Informe</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
