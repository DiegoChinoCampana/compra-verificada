import { RUNS_ONE_PER_DAY_CTE } from "./runsOnePerDay.js";

/** Normaliza título (mismo producto = mismo texto salvo mayúsculas/espacios). */
export function sqlNormTitle(alias: string): string {
  return `trim(both from regexp_replace(lower(coalesce(${alias}.title, '')), E'\\\\s+', ' ', 'g'))`;
}

/**
 * Clave de agrupación estable: `product_key` del batch semántico si existe; si no, título normalizado
 * (mismo criterio que antes).
 */
export function sqlProductGroupingKey(alias: string): string {
  const n = sqlNormTitle(alias);
  return `COALESCE(NULLIF(trim(${alias}.product_key), ''), ${n})`;
}

/** Filtro exacto por `product_key` (batch clustering). `keyIdx` = placeholder $ en la consulta. */
export function sqlWhereProductKey(alias: string, keyIdx: number): string {
  return `(trim(coalesce(${alias}.product_key, '')) = trim($${keyIdx}::text))`;
}

/**
 * Tras `runs_one_per_day`: candidatos por corrida (precio mínimo) y título canónico
 * (moda entre esos ganadores por corrida; desempate por corrida más reciente).
 * $1 = results.search_id (artículo).
 */
export const CTE_CANONICAL_PRODUCT_TITLE = `
${RUNS_ONE_PER_DAY_CTE.trim()},
per_run_price_rank AS (
  SELECT
    sr.id AS scrape_run_id,
    sr.executed_at,
    ${sqlProductGroupingKey("r")} AS norm_title,
    r.title AS raw_title,
    r.product_key AS result_product_key,
    r.price::float8 AS price,
    ROW_NUMBER() OVER (PARTITION BY sr.id ORDER BY r.price ASC NULLS LAST) AS rn
  FROM results r
  INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
  INNER JOIN runs_one_per_day d ON d.scrape_run_id = sr.id
  WHERE r.search_id = $1 AND r.price IS NOT NULL
),
canonical_norm_title AS (
  SELECT
    mode_norm.norm_title,
    (
      SELECT CASE
        WHEN mk.has_key THEN mk.key_text
        ELSE mk.fallback_title
      END
      FROM (
        SELECT
          trim(max(coalesce(pr.result_product_key, ''))) <> '' AS has_key,
          trim(max(pr.result_product_key)) AS key_text,
          (array_agg(pr.raw_title ORDER BY pr.executed_at DESC))[1]::text AS fallback_title
        FROM per_run_price_rank pr
        WHERE pr.rn = 1 AND pr.norm_title = mode_norm.norm_title
      ) mk
    ) AS display_title
  FROM (
    SELECT pr.norm_title
    FROM per_run_price_rank pr
    WHERE pr.rn = 1 AND pr.norm_title <> ''
    GROUP BY pr.norm_title
    ORDER BY COUNT(*) DESC, MAX(pr.executed_at) DESC
    LIMIT 1
  ) mode_norm
)
`;

/** Filtra filas de `alias` al mismo producto que el título canónico; si no hay canónico, no filtra. */
export function sqlWhereTitleMatchesCanonical(alias: string): string {
  const gk = sqlProductGroupingKey(alias);
  return `(
  NOT EXISTS (SELECT 1 FROM canonical_norm_title)
  OR ${gk} = (SELECT c.norm_title FROM canonical_norm_title c)
)`;
}

/**
 * Filtro explícito por título de publicación (normalizado) y opcionalmente tienda/vendedor.
 * `titleIdx` / `sellerIdx` = posición del placeholder $ en la consulta ($2 y $3 típico tras search_id).
 */
export function sqlWhereManualProductTitleAndSeller(
  alias: string,
  titleIdx: number,
  sellerIdx: number,
): string {
  const n = sqlNormTitle(alias);
  return `(
  ${n} = trim(both from regexp_replace(lower(trim($${titleIdx}::text)), E'\\\\s+', ' ', 'g'))
  AND (
    $${sellerIdx}::text IS NULL
    OR length(trim($${sellerIdx}::text)) = 0
    OR coalesce(trim(${alias}.seller), '') ILIKE '%' || trim($${sellerIdx}::text) || '%'
  )
)`;
}
