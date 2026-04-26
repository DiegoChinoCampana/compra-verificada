import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import type { Article, ProductClusteringMetaPayload, ProductClusteringRunResponse } from "../types";

/** Acepta coma decimal (p. ej. teclado es-AR) en inputs controlados. */
function parseDecimalInput(raw: string, fallback: number): number {
  const t = raw.trim().replace(",", ".");
  if (t === "" || t === "-" || t === ".") return fallback;
  const n = Number(t);
  return Number.isFinite(n) ? n : fallback;
}

export function OperationalPage() {
  const [stale, setStale] = useState<Article[]>([]);
  const [missing, setMissing] = useState<Article[]>([]);
  const [clusterMeta, setClusterMeta] = useState<ProductClusteringMetaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clusterArticle, setClusterArticle] = useState("");
  const [clusterDays, setClusterDays] = useState(60);
  const [clusterSecret, setClusterSecret] = useState("");
  const [clusterMode, setClusterMode] = useState<"full" | "embed" | "cluster">("full");
  const [clusterResetArticleWindow, setClusterResetArticleWindow] = useState(false);
  const [clusterReset, setClusterReset] = useState(false);
  const [clusterMinSimilarity, setClusterMinSimilarity] = useState(0.9);
  const [clusterMinPts, setClusterMinPts] = useState(2);
  const [clusterCentroidMergeSim, setClusterCentroidMergeSim] = useState(0.92);
  const [clusterSkipCentroidMerge, setClusterSkipCentroidMerge] = useState(false);
  const [clusterLimit, setClusterLimit] = useState(8000);
  const [clusterBatchSize, setClusterBatchSize] = useState(40);
  const [clusterRunning, setClusterRunning] = useState(false);
  const [clusterRunError, setClusterRunError] = useState<string | null>(null);
  const [clusterRunOk, setClusterRunOk] = useState<string | null>(null);

  const reloadLists = useCallback(async (signal?: AbortSignal) => {
    const [s, m, c] = await Promise.all([
      fetchJson<Article[]>(`/api/analytics/operational/stale-scrapes?days=7`, { signal }),
      fetchJson<Article[]>(`/api/analytics/operational/missing-recent-results?days=14`, {
        signal,
      }),
      fetchJson<ProductClusteringMetaPayload>(`/api/analytics/operational/product-clustering-meta`, {
        signal,
      }),
    ]);
    setStale(s);
    setMissing(m);
    setClusterMeta(c);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      setError(null);
      try {
        await reloadLists(ac.signal);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [reloadLists]);

  async function onRunClustering(e: FormEvent) {
    e.preventDefault();
    setClusterRunError(null);
    setClusterRunOk(null);
    const article = clusterArticle.trim();
    if (article.length < 2) {
      setClusterRunError("Indicá un texto de artículo (mínimo 2 caracteres).");
      return;
    }
    if (clusterMeta?.requiresClusterBatchSecret && !clusterSecret.trim()) {
      setClusterRunError("En este entorno hay que ingresar el token de clustering.");
      return;
    }
    setClusterRunning(true);
    try {
      const body: Record<string, unknown> = {
        article,
        days: clusterDays,
        resetArticleWindow: clusterResetArticleWindow,
        resetScope: clusterReset,
        embedOnly: clusterMode === "embed",
        clusterOnly: clusterMode === "cluster",
        minSimilarity: clusterMinSimilarity,
        minPts: clusterMinPts,
        centroidMergeMinSimilarity: clusterCentroidMergeSim,
        skipCentroidMerge: clusterSkipCentroidMerge,
        limit: clusterLimit,
        batchSize: clusterBatchSize,
      };
      if (clusterSecret.trim()) body.secret = clusterSecret.trim();

      const res = await fetchJson<ProductClusteringRunResponse>(
        `/api/analytics/operational/product-clustering-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { timeoutMs: 600_000 },
      );
      if (!res.ok) {
        setClusterRunError(res.error);
        return;
      }
      const r = res.result;
      const tail =
        r.embedded === 0 && r.clusteredRows === 0
          ? " No hubo filas nuevas para embed ni embeddings en la ventana para agrupar (revisá artículo / días o ejecutá solo «embed» primero)."
          : "";
      const refreshHint =
        r.embedded > 0 || r.clusteredRows > 0
          ? " En Resultados / listados, usá «Recargar datos» o F5: la tabla no se actualiza sola."
          : "";
      const scopeHint =
        r.clusteredRows > 0
          ? ` Solo esas ${r.clusteredRows} filas (con embedding en el universo del batch) tienen o actualizan product_key; el resto de resultados sigue sin clave hasta tener embedding.`
          : "";
      const embedZeroNote =
        clusterMode !== "cluster" && r.embedded === 0 && r.clusteredRows > 0
          ? " Embeddings nuevos: 0 porque en artículo+ventana no había filas con título sin vector en result_embeddings (en ese corte ya estaban embedidas, o no hay listados que cumplan el filtro). No es un error."
          : "";
      setClusterRunOk(
        `Listo en ${(r.durationMs / 1000).toFixed(1)}s · embeddings escritos: ${r.embedded} · filas procesadas en cluster: ${r.clusteredRows} (en clúster: ${r.inCluster}, ruido: ${r.noise}).${tail}${embedZeroNote}${refreshHint}${scopeHint}`,
      );
      const meta = await fetchJson<ProductClusteringMetaPayload>(
        `/api/analytics/operational/product-clustering-meta`,
      );
      setClusterMeta(meta);
    } catch (err) {
      setClusterRunError(String(err));
    } finally {
      setClusterRunning(false);
    }
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  const needSecret = Boolean(clusterMeta?.requiresClusterBatchSecret);
  const submitDisabled = clusterRunning || (needSecret && !clusterSecret.trim());

  return (
    <div>
      <h1>Operación</h1>
      <p className="lede">
        Señales para administración: artículos con scrape desactualizado y artículos sin
        resultados recientes en la base.
      </p>

      <section className="card block">
        <h2>Clustering semántico (product_key)</h2>
        <p className="muted small">
          Genera embeddings (OpenAI) y asigna <code>product_key</code> en la base. Podés usar el
          botón (misma lógica que el script) o la terminal con{" "}
          <code>npm run embed:cluster --prefix server</code>. Hace falta{" "}
          <code>OPENAI_API_KEY</code> en el servidor y Postgres con extensión <code>vector</code>.
          Tras un <code>git pull</code> o cambios en <code>server/.env</code>, reiniciá el proceso del
          API (desde la raíz del repo: <code>npm run dev</code> levanta web + API; el servidor usa{" "}
          <code>tsx watch</code> y suele recargar solo al guardar archivos en <code>server/</code>).
        </p>
        {clusterMeta && clusterMeta.openAiConfigured === false ? (
          <p className="error" style={{ marginTop: "0.5rem" }}>
            Este servidor <strong>no tiene</strong> <code>OPENAI_API_KEY</code>: el modo completo o
            «Solo embeddings» va a fallar hasta que la agregues en <code>server/.env</code> y
            reinicies la API. Si ya cargaste embeddings antes, podés usar «Solo clustering».
          </p>
        ) : null}
        {clusterMeta?.requiresClusterBatchSecret ? (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            <strong>Token obligatorio:</strong> en Vercel hay que definir{" "}
            <code>CLUSTER_BATCH_SECRET</code> en el proyecto; en local también si lo pusiste en{" "}
            <code>server/.env</code>. Ingresá el mismo valor abajo (no viaja por URL). Si el token
            está vacío, el botón «Ejecutar» queda deshabilitado y parece que no pasa nada.
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            En desarrollo local sin <code>CLUSTER_BATCH_SECRET</code> el endpoint acepta la
            corrida sin token (no exponer el puerto a internet).
          </p>
        )}

        <form className="card" style={{ marginTop: "0.75rem", padding: "1rem" }} onSubmit={onRunClustering}>
          {needSecret && !clusterSecret.trim() ? (
            <p className="error" style={{ marginBottom: "0.5rem" }}>
              Ingresá el token para poder ejecutar (mismo valor que <code>CLUSTER_BATCH_SECRET</code> en
              el servidor).
            </p>
          ) : null}
          <div className="field-grid" style={{ gap: "0.75rem" }}>
            <label>
              Texto de artículo (ILIKE)
              <input
                value={clusterArticle}
                onChange={(e) => setClusterArticle(e.target.value)}
                placeholder="Ej: Microondas"
                autoComplete="off"
                required
                minLength={2}
              />
            </label>
            <label>
              Ventana (días)
              <input
                type="number"
                min={7}
                max={120}
                value={clusterDays}
                onChange={(e) => setClusterDays(Number(e.target.value) || 60)}
              />
            </label>
            <label>
              Modo
              <select
                value={clusterMode}
                onChange={(e) => setClusterMode(e.target.value as "full" | "embed" | "cluster")}
              >
                <option value="full">Completo (embed + cluster)</option>
                <option value="embed">Solo embeddings</option>
                <option value="cluster">Solo clustering</option>
              </select>
              <span className="muted small" style={{ display: "block", marginTop: "0.2rem" }}>
                En «Completo», si ves <strong>embeddings escritos: 0</strong>, en ese artículo y ventana no
                quedaban listados con título pendientes de vector (no indica fallo).
              </span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={clusterResetArticleWindow}
                  onChange={(e) => setClusterResetArticleWindow(e.target.checked)}
                />
                Borrar <code>product_key</code> en <strong>todo</strong> el artículo + ventana (días)
                antes de reagrupar
              </span>
              <span className="muted small" style={{ paddingLeft: "1.5rem" }}>
                Quita claves viejas o malas también en filas <strong>sin</strong> embedding o que no
                entran en el límite de filas del batch. Después solo recuperan clave las filas con
                vector que el algoritmo agrupa (modo «Solo clustering» o paso cluster del completo).
              </span>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={clusterReset}
                  onChange={(e) => setClusterReset(e.target.checked)}
                />
                Resetear claves solo en el lote con embedding (antes de DBSCAN)
              </span>
              <span className="muted small" style={{ paddingLeft: "1.5rem" }}>
                Afecta únicamente las filas que entran al clustering con límite; el resto del artículo
                no se modifica. Si marcás la opción de arriba, esta suele ser redundante.
              </span>
            </label>
            <label>
              Similitud mín. vecinos (DBSCAN)
              <input
                type="number"
                min={0.5}
                max={0.999}
                step={0.01}
                value={clusterMinSimilarity}
                onChange={(e) => setClusterMinSimilarity(parseDecimalInput(e.target.value, 0.9))}
              />
              <span className="muted small" style={{ display: "block", marginTop: "0.2rem" }}>
                Umbral coseno entre listados del mismo cluster (por defecto 0.9).
              </span>
            </label>
            <label>
              minPts (DBSCAN)
              <input
                type="number"
                min={2}
                max={20}
                step={1}
                value={clusterMinPts}
                onChange={(e) => setClusterMinPts(Math.round(Number(e.target.value)) || 2)}
              />
            </label>
            <label>
              Fusión por centroides — sim. mín.
              <input
                type="number"
                min={0.5}
                max={0.999}
                step={0.01}
                value={clusterCentroidMergeSim}
                onChange={(e) => setClusterCentroidMergeSim(parseDecimalInput(e.target.value, 0.92))}
                disabled={clusterSkipCentroidMerge}
              />
              <span className="muted small" style={{ display: "block", marginTop: "0.2rem" }}>
                Une clusters distintos si sus centroides son tan similares (0.88 = más uniones).
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={clusterSkipCentroidMerge}
                onChange={(e) => setClusterSkipCentroidMerge(e.target.checked)}
              />
              Desactivar fusión por centroides
            </label>
            <label>
              Límite de filas (embed + cluster)
              <input
                type="number"
                min={100}
                max={20000}
                step={100}
                value={clusterLimit}
                onChange={(e) => setClusterLimit(Math.round(Number(e.target.value)) || 8000)}
              />
            </label>
            <label>
              Tamaño de lote embeddings
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={clusterBatchSize}
                onChange={(e) => setClusterBatchSize(Math.round(Number(e.target.value)) || 40)}
              />
            </label>
            <label>
              Token <span className="muted">(si aplica)</span>
              <input
                type="password"
                value={clusterSecret}
                onChange={(e) => setClusterSecret(e.target.value)}
                placeholder={needSecret ? "CLUSTER_BATCH_SECRET" : "Opcional en local"}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="form-actions" style={{ marginTop: "0.75rem" }}>
            <button
              type="submit"
              disabled={submitDisabled}
              title={
                clusterRunning
                  ? "Corrida en curso en el servidor…"
                  : needSecret && !clusterSecret.trim()
                    ? "Completá el token (mismo valor que CLUSTER_BATCH_SECRET en el servidor)"
                    : undefined
              }
            >
              {clusterRunning ? "Ejecutando…" : "Ejecutar clustering"}
            </button>
          </div>
          {clusterRunning ? (
            <p className="warn" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              Corriendo en el servidor… puede tardar varios minutos (OpenAI + base de datos). No
              cierres esta pestaña.
            </p>
          ) : null}
          {clusterRunError ? (
            <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              {clusterRunError}
            </p>
          ) : null}
          {clusterRunOk ? <div className="notice-ok">{clusterRunOk}</div> : null}
        </form>

        <pre
          className="muted small"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem",
            background: "rgba(0,0,0,0.05)",
            borderRadius: 6,
            overflow: "auto",
          }}
        >
          cd server{"\n"}
          npm run embed:cluster -- --article=Microondas --days=60
        </pre>
        {clusterMeta?.countsError ? (
          <p className="error" style={{ marginTop: "0.75rem" }}>
            Conteos no disponibles: {clusterMeta.countsError}
          </p>
        ) : clusterMeta?.counts ? (
          <ul className="muted small" style={{ marginTop: "0.75rem" }}>
            <li>
              Resultados con <code>product_key</code>:{" "}
              <strong>{clusterMeta.counts.with_product_key}</strong> /{" "}
              {clusterMeta.counts.total_results} totales
            </li>
            <li>
              Filas en <code>result_embeddings</code>:{" "}
              <strong>{clusterMeta.counts.with_embedding}</strong>
            </li>
          </ul>
        ) : null}
        {clusterMeta?.lastRun ? (
          <p className="muted small" style={{ marginTop: "0.75rem" }}>
            <strong>Última corrida:</strong>{" "}
            {new Date(clusterMeta.lastRun.finishedAt).toLocaleString("es-AR")} · artículo ILIKE «
            {clusterMeta.lastRun.article}» · ventana {clusterMeta.lastRun.days} días · embeddings{" "}
            {clusterMeta.lastRun.embedded} · filas agrupadas {clusterMeta.lastRun.clusteredRows}{" "}
            (en clúster {clusterMeta.lastRun.inCluster}, ruido {clusterMeta.lastRun.noise}) · sim ≥{" "}
            {clusterMeta.lastRun.minSimilarity} · minPts {clusterMeta.lastRun.minPts}
            {clusterMeta.lastRun.resetArticleWindow ? " · reset amplio (artículo+ventana)" : ""}
            {clusterMeta.lastRun.resetScope ? " · reset lote" : ""}
            {clusterMeta.lastRun.skipCentroidMerge
              ? " · sin fusión centroides"
              : clusterMeta.lastRun.centroidMergeMinSimilarity != null
                ? ` · fusión centroides sim ≥ ${clusterMeta.lastRun.centroidMergeMinSimilarity}`
                : ""}{" "}
            · {(clusterMeta.lastRun.durationMs / 1000).toFixed(1)}s
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: "0.75rem" }}>
            Todavía no hay registro de una corrida exitosa (config id 100).
          </p>
        )}
        <p className="muted small" style={{ marginTop: "0.5rem" }}>
          En <Link to="/resultados">Resultados</Link> y en los listados por artículo verás{" "}
          <code>product_key</code> y <code>product_cluster_id</code> cuando existan.
        </p>
      </section>

      <section className="card block">
        <h2>Scrapes viejos (habilitados, +7 días sin scrape o sin fecha)</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Artículo</th>
                <th>Marca</th>
                <th>Último scrape</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stale.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.article}</td>
                  <td>{a.brand ?? "—"}</td>
                  <td>
                    {a.last_scraped_at
                      ? new Date(a.last_scraped_at).toLocaleString("es-AR")
                      : "—"}
                  </td>
                  <td className="actions">
                    <Link to={`/articulos/${a.id}`}>Tablero</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!stale.length && <p className="muted pad">No hay registros en este corte.</p>}
        </div>
      </section>

      <section className="card block">
        <h2>Sin resultados en los últimos 14 días</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Artículo</th>
                <th>Marca</th>
                <th>Último scrape</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {missing.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.article}</td>
                  <td>{a.brand ?? "—"}</td>
                  <td>
                    {a.last_scraped_at
                      ? new Date(a.last_scraped_at).toLocaleString("es-AR")
                      : "—"}
                  </td>
                  <td className="actions">
                    <Link to={`/articulos/${a.id}`}>Tablero</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!missing.length && <p className="muted pad">No hay registros en este corte.</p>}
        </div>
      </section>
    </div>
  );
}
