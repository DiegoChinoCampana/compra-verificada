import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchJson } from "../../api";
import type { PeerGapByNamePayload } from "../../types";
import { AnalysisTechnicalHelp } from "./AnalysisTechnicalHelp";

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
        fichas desalineadas respecto al resto del grupo.{" "}
        <strong>Solo escribís en el campo de búsqueda un fragmento del artículo de la ficha</strong> (como en
        otras pantallas de análisis): el <strong>detalle</strong> no lo ingresás acá; es el texto que ya
        figura en cada ficha en la base (<em>detalle</em> al dar de alta o editar la búsqueda) y la
        herramienta lo usa para armar grupos entre marcas comparables.
      </p>
      <p className="muted small">
        Compará el precio de referencia de cada ficha habilitada contra la{" "}
        <strong>mediana</strong> de otras marcas del mismo grupo. Orden: mayor magnitud de brecha primero.
      </p>
      <p className="muted small">
        <strong>Mismo “producto” acá no es el título de Mercado Libre.</strong> El agrupamiento usa solo los
        textos guardados en la ficha: <em>artículo</em> y <em>detalle</em> (ambos vienen de la configuración
        de cada búsqueda, no del listado de ML), iguales salvo mayúsculas/minúsculas y espacios al inicio o
        al final. Si dos fichas tienen distinto detalle o distinto artículo normalizado, no entran en el
        mismo grupo aunque en el listado aparezcan publicaciones con título parecido.
      </p>

      <AnalysisTechnicalHelp>
        <p>
          <strong>Qué mirás en la base.</strong> El formulario solo filtra por texto en{" "}
          <code>articles.article</code> (<code>ILIKE</code>, fichas <code>enabled = true</code>, hasta 120
          filas). El campo <code>articles.detail</code>{" "}
          <strong>no se escribe en esta pantalla</strong>: es el valor que ya tiene cada ficha en la base; a
          partir de cada candidata se buscan <strong>todas</strong> las fichas habilitadas con el mismo
          artículo y el mismo detalle normalizados para formar el grupo peer. El grupo no usa{" "}
          <code>results.title</code> de Mercado Libre. Normalización: <code>lower(trim(·))</code>; detalle
          vacío en la ficha cuenta como cadena vacía.
        </p>
        <ol>
          <li>
            <strong>Candidatas:</strong> esas fichas que coinciden con el texto en <code>articles.article</code>
            .
          </li>
          <li>
            <strong>Grupo peer:</strong> todas las filas de <code>articles</code> habilitadas que comparten
            mismo artículo + detalle (normalizado) con alguna candidata.
          </li>
          <li>
            <strong>Precio de referencia por ficha:</strong> en <code>results</code> se toma la corrida más
            reciente por <code>search_id</code> (vía <code>scrape_runs.executed_at</code>); el mínimo de{" "}
            <code>price</code> en esa corrida, solo valores positivos.
          </li>
          <li>
            <strong>Mediana de peers:</strong> sobre esos mínimos, la mediana (<code>percentile_cont(0.5)</code>
            ) de las <strong>otras</strong> fichas del mismo grupo (mismo artículo + detalle, otro{" "}
            <code>id</code>).
          </li>
          <li>
            <strong>Brecha %:</strong> <code>(mi_ref_min − mediana_peers) / mediana_peers</code>. Positivo:
            esta ficha quedó por encima del centro del grupo; negativo: por debajo.
          </li>
        </ol>
      </AnalysisTechnicalHelp>

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
            <span className="muted small" style={{ display: "block", marginTop: "0.35rem" }}>
              El detalle de cada ficha no se busca acá: se usa el guardado en la ficha para agrupar marcas
              comparables.
            </span>
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
