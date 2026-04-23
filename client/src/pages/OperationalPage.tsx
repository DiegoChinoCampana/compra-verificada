import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import type { Article } from "../types";

export function OperationalPage() {
  const [stale, setStale] = useState<Article[]>([]);
  const [missing, setMissing] = useState<Article[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [s, m] = await Promise.all([
          fetchJson<Article[]>(`/api/analytics/operational/stale-scrapes?days=7`),
          fetchJson<Article[]>(`/api/analytics/operational/missing-recent-results?days=14`),
        ]);
        if (!cancelled) {
          setStale(s);
          setMissing(m);
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
