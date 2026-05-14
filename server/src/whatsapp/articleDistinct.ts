import type { Pool } from "pg";

const LIST_LIMIT = 120;
const SHOW_COUNT = 12;

export { SHOW_COUNT };

export async function distinctArticleTypes(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ v: string }>(
    `SELECT DISTINCT trim(article) AS v
     FROM articles
     WHERE enabled = true AND article IS NOT NULL AND trim(article) <> ''
     ORDER BY v
     LIMIT ${LIST_LIMIT}`,
  );
  return rows.map((r) => r.v);
}

export async function distinctBrandsForArticle(pool: Pool, article: string): Promise<string[]> {
  const { rows } = await pool.query<{ v: string }>(
    `SELECT DISTINCT trim(brand) AS v
     FROM articles
     WHERE enabled = true
       AND lower(trim(article)) = lower(trim($1::text))
       AND brand IS NOT NULL AND trim(brand) <> ''
     ORDER BY v
     LIMIT ${LIST_LIMIT}`,
    [article],
  );
  return rows.map((r) => r.v);
}

export async function distinctDetailsForArticleBrand(
  pool: Pool,
  article: string,
  brand: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ v: string }>(
    `SELECT DISTINCT trim(detail) AS v
     FROM articles
     WHERE enabled = true
       AND lower(trim(article)) = lower(trim($1::text))
       AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce($2::text, '')))
       AND detail IS NOT NULL AND trim(detail) <> ''
     ORDER BY v
     LIMIT ${LIST_LIMIT}`,
    [article, brand || ""],
  );
  return rows.map((r) => r.v);
}

export async function resolveArticleIdByTriple(
  pool: Pool,
  triple: { article: string; brand: string; detail: string },
): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM articles
     WHERE enabled = true
       AND lower(trim(article)) = lower(trim($1::text))
       AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce($2::text, '')))
       AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($3::text, '')))
     ORDER BY id DESC
     LIMIT 1`,
    [triple.article, triple.brand ?? "", triple.detail ?? ""],
  );
  return rows[0]?.id ?? null;
}
