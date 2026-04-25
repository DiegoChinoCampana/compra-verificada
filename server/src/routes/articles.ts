import { Router } from "express";
import { pool } from "../db.js";
import { parseProductScopeQuery } from "../productScopeQuery.js";
import { sqlWhereManualProductTitleAndSeller } from "../sql/articleSameProductTitle.js";

export const articlesRouter = Router();

articlesRouter.get("/", async (req, res) => {
  const article = typeof req.query.article === "string" ? req.query.article.trim() : "";
  const brand = typeof req.query.brand === "string" ? req.query.brand.trim() : "";
  const detail = typeof req.query.detail === "string" ? req.query.detail.trim() : "";
  const enabledRaw = req.query.enabled;
  const enabled =
    enabledRaw === "true" ? true : enabledRaw === "false" ? false : null;

  const sql = `
    SELECT
      id,
      article,
      brand,
      detail,
      enabled,
      created_at,
      last_scraped_at,
      ordered_by,
      official_store_required,
      free_shipping_required
    FROM articles
    WHERE ($1::text = '' OR article ILIKE '%' || $1 || '%')
      AND ($2::text = '' OR COALESCE(brand, '') ILIKE '%' || $2 || '%')
      AND ($3::text = '' OR COALESCE(detail, '') ILIKE '%' || $3 || '%')
      AND ($4::boolean IS NULL OR enabled = $4)
    ORDER BY id DESC
    LIMIT 500
  `;
  const { rows } = await pool.query(sql, [article, brand, detail, enabled]);
  res.json(rows);
});

articlesRouter.get("/:id/results", async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isInteger(articleId)) {
    res.status(400).json({ error: "Invalid article id" });
    return;
  }
  const exists = await pool.query("SELECT 1 FROM articles WHERE id = $1", [articleId]);
  if (!exists.rowCount) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const pq = parseProductScopeQuery(req);
  const scopeF = pq.manual ? sqlWhereManualProductTitleAndSeller("r", 2, 3) : "TRUE";
  const scopeWhere = pq.manual ? `AND ${scopeF}` : "";

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM results r WHERE r.search_id = $1 ${scopeWhere}`,
    pq.manual ? [articleId, pq.productTitle, pq.sellerOrNull] : [articleId],
  );
  const total = (countRows[0] as { n: number }).n;

  const { rows } = await pool.query(
    `SELECT
      r.id,
      r.scrape_run_id,
      sr.executed_at AS run_executed_at,
      r.title,
      r.price::float8 AS price,
      r.rating::float8 AS rating,
      r.url,
      r.seller,
      r.seller_score,
      r.created_at,
      r.scrape_run_criteria,
      r.official_store_required,
      r.official_store_applied,
      r.free_shipping_required,
      r.free_shipping_applied,
      r.product_key,
      r.product_cluster_id,
      r.product_confidence::float8 AS product_confidence
    FROM results r
    INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    WHERE r.search_id = $1 ${scopeWhere}
    ORDER BY sr.executed_at DESC NULLS LAST, r.id DESC
    LIMIT $${pq.manual ? 4 : 2} OFFSET $${pq.manual ? 5 : 3}`,
    pq.manual
      ? [articleId, pq.productTitle, pq.sellerOrNull, limit, offset]
      : [articleId, limit, offset],
  );

  res.json({
    total,
    limit,
    page,
    offset,
    rows,
  });
});

articlesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT
      id, article, brand, detail, enabled, created_at, last_scraped_at, ordered_by,
      official_store_required, free_shipping_required
    FROM articles WHERE id = $1`,
    [id],
  );
  if (!rows.length) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.json(rows[0]);
});
