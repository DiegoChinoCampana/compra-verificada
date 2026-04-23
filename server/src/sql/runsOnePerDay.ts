/**
 * Para un artículo ($1 = results.search_id): una sola corrida por día calendario
 * (la de `executed_at` más reciente ese día). Solo días con al menos un precio.
 */
export const RUNS_ONE_PER_DAY_CTE = `
runs_one_per_day AS (
  SELECT DISTINCT ON (date_trunc('day', sr.executed_at))
    sr.id AS scrape_run_id,
    sr.executed_at
  FROM results r
  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
  WHERE r.search_id = $1 AND r.price IS NOT NULL
  ORDER BY date_trunc('day', sr.executed_at), sr.executed_at DESC
)`;
