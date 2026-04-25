import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import type { Article, ProductClusteringMetaPayload } from "../types";

export function OperationalPage() {
  const [stale, setStale] = useState<Article[]>([]);
  const [missing, setMissing] = useState<Article[]>([]);
  const [clusterMeta, setClusterMeta] = useState<ProductClusteringMetaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [s, m, c] = await Promise.all([
          fetchJson<Article[]>(`/api/analytics/operational/stale-scrapes?days=7`),
          fetchJson<Article[]>(`/api/analytics/operational/missing-recent-results?days=14`),
          fetchJson<ProductClusteringMetaPayload>(
            `/api/analytics/operational/product-clustering-meta`,
          ),
        ]);
        if (!cancelled) {
          setStale(s);
          setMissing(m);
          setClusterMeta(c);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="error">{error}</p>;
  }

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
          El batch <strong>no corre solo</strong>: hay que ejecutarlo en la máquina donde está el
          código y las variables <code>OPENAI_API_KEY</code> / Postgres. Al terminar bien, se
          guarda un resumen en la base; acá ves la última corrida y cuántas filas tienen clave /
          embedding.
        </p>
        <pre
          className="muted small"
          style={{
            marginTop: "0.5rem",
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
            Todavía no hay registro de una corrida exitosa del script (o la fila de config id 100
            no existe).
          </p>
        )}
        <p className="muted small" style={{ marginTop: "0.5rem" }}>
          En <Link to="/resultados">Resultados</Link> y en los listados por artículo verás las
          columnas <code>product_key</code> y <code>product_cluster_id</code> cuando existan.
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
