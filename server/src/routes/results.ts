import { Router } from "express";
import { pool } from "../db.js";

export const resultsRouter = Router();

resultsRouter.get("/", async (req, res) => {
  const article = typeof req.query.article === "string" ? req.query.article.trim() : "";
  const brand = typeof req.query.brand === "string" ? req.query.brand.trim() : "";
  const detail = typeof req.query.detail === "string" ? req.query.detail.trim() : "";
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const seller = typeof req.query.seller === "string" ? req.query.seller.trim() : "";

  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const sortRaw = typeof req.query.sort === "string" ? req.query.sort.trim() : "";
  const sortByProductKey = sortRaw === "product_key";
  const orderBy = sortByProductKey
    ? `(CASE WHEN NULLIF(trim(coalesce(r.product_key, '')), '') IS NULL THEN 1 ELSE 0 END) ASC,
       lower(trim(coalesce(r.product_key, ''))) ASC NULLS LAST,
       sr.executed_at DESC NULLS LAST,
       r.created_at DESC`
    : "r.created_at DESC";

  const where = `
    ($1::text = '' OR a.article ILIKE '%' || $1 || '%')
    AND ($2::text = '' OR COALESCE(a.brand, '') ILIKE '%' || $2 || '%')
    AND ($3::text = '' OR COALESCE(a.detail, '') ILIKE '%' || $3 || '%')
    AND ($4::text = '' OR COALESCE(r.title, '') ILIKE '%' || $4 || '%')
    AND ($5::text = '' OR COALESCE(r.seller, '') ILIKE '%' || $5 || '%')
  `;
  const baseParams = [article, brand, detail, title, seller];

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM results r
     INNER JOIN articles a ON a.id = r.search_id
     INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
     WHERE ${where}`,
    baseParams,
  );
  const total = (countRows[0] as { n: number }).n;

  const { rows } = await pool.query(
    `SELECT
       r.id AS result_id,
       r.search_id AS article_id,
       a.article,
       a.brand,
       a.detail,
       r.title,
       r.seller,
       r.price::float8 AS price,
       r.rating::float8 AS rating,
       r.url,
       r.created_at,
       sr.id AS scrape_run_id,
       sr.executed_at AS run_executed_at,
       r.product_key,
       r.product_cluster_id,
       r.product_confidence::float8 AS product_confidence
     FROM results r
     INNER JOIN articles a ON a.id = r.search_id
     INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $6 OFFSET $7`,
    [...baseParams, limit, offset],
  );

  res.json({
    total,
    limit,
    page,
    offset,
    rows,
  });
});
