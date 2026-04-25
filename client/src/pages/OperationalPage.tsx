import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import type { Article, ProductClusteringMetaPayload, ProductClusteringRunResponse } from "../types";

export function OperationalPage() {
  const [stale, setStale] = useState<Article[]>([]);
  const [missing, setMissing] = useState<Article[]>([]);
  const [clusterMeta, setClusterMeta] = useState<ProductClusteringMetaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [clusterArticle, setClusterArticle] = useState("");
  const [clusterDays, setClusterDays] = useState(60);
  const [clusterSecret, setClusterSecret] = useState("");
  const [clusterMode, setClusterMode] = useState<"full" | "embed" | "cluster">("full");
  const [clusterReset, setClusterReset] = useState(false);
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
        resetScope: clusterReset,
        embedOnly: clusterMode === "embed",
        clusterOnly: clusterMode === "cluster",
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
      setClusterRunOk(
        `Listo en ${(res.result.durationMs / 1000).toFixed(1)}s · embeddings ${res.result.embedded} · en clúster ${res.result.inCluster} (ruido ${res.result.noise}).`,
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
  const submitDisabled =
    clusterRunning || (needSecret && !clusterSecret.trim()) || clusterArticle.trim().length < 2;

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
        </p>
        {clusterMeta?.requiresClusterBatchSecret ? (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            <strong>Producción / Vercel:</strong> configurá <code>CLUSTER_BATCH_SECRET</code> en las
            variables de entorno e ingresá el mismo valor abajo como token (no viaja por URL).
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: "0.35rem" }}>
            En desarrollo local sin <code>CLUSTER_BATCH_SECRET</code> el endpoint acepta la
            corrida sin token (no exponer el puerto a internet).
          </p>
        )}

        <form className="card" style={{ marginTop: "0.75rem", padding: "1rem" }} onSubmit={onRunClustering}>
          <div className="field-grid" style={{ gap: "0.75rem" }}>
            <label>
              Texto de artículo (ILIKE)
              <input
                value={clusterArticle}
                onChange={(e) => setClusterArticle(e.target.value)}
                placeholder="Ej: Microondas"
                autoComplete="off"
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
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={clusterReset}
                onChange={(e) => setClusterReset(e.target.checked)}
              />
              Resetear claves en el universo antes de agrupar
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
            <button type="submit" disabled={submitDisabled}>
              {clusterRunning ? "Ejecutando…" : "Ejecutar clustering"}
            </button>
          </div>
        </form>

        {clusterRunError ? <p className="error" style={{ marginTop: "0.75rem" }}>{clusterRunError}</p> : null}
        {clusterRunOk ? (
          <p className="muted small" style={{ marginTop: "0.75rem" }}>
            {clusterRunOk}
          </p>
        ) : null}

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
            {clusterMeta.lastRun.resetScope ? " · con reset" : ""} ·{" "}
            {(clusterMeta.lastRun.durationMs / 1000).toFixed(1)}s
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
