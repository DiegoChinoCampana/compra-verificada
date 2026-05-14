import type { Pool } from "pg";

export type ArticleTripleInput = {
  article: string;
  brand: string;
  detail: string;
};

export async function findArticleIdByTriple(
  pool: Pool,
  input: ArticleTripleInput,
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT id FROM articles
     WHERE lower(trim(article)) = lower(trim($1::text))
       AND lower(trim(coalesce(brand, ''))) = lower(trim(coalesce($2::text, '')))
       AND lower(trim(coalesce(detail, ''))) = lower(trim(coalesce($3::text, '')))
     LIMIT 1`,
    [input.article, input.brand ?? "", input.detail ?? ""],
  );
  const r = rows[0] as { id: number } | undefined;
  return r?.id ?? null;
}

export async function insertArticleTriple(
  pool: Pool,
  input: ArticleTripleInput,
): Promise<{ id: number; existed: boolean }> {
  const article = input.article.trim();
  const brand = (input.brand ?? "").trim() || null;
  const detail = (input.detail ?? "").trim() || null;
  if (!article) {
    throw new Error("article_required");
  }
  const existing = await findArticleIdByTriple(pool, {
    article,
    brand: brand ?? "",
    detail: detail ?? "",
  });
  if (existing != null) {
    return { id: existing, existed: true };
  }
  const { rows } = await pool.query(
    `INSERT INTO articles (article, brand, detail, enabled, ordered_by)
     VALUES ($1, $2, $3, true, 'Más relevantes')
     RETURNING id`,
    [article, brand, detail],
  );
  return { id: (rows[0] as { id: number }).id, existed: false };
}
