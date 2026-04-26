import { Router } from "express";
import { pool } from "../db.js";
import { parseProductScopeQuery, productScopeMode } from "../productScopeQuery.js";
import {
  sqlWhereManualProductTitleAndSeller,
  sqlWhereProductKey,
} from "../sql/articleSameProductTitle.js";

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
  const mode = productScopeMode(pq);
  const scopeF =
    mode === "key" && pq.productKey
      ? sqlWhereProductKey("r", 2)
      : mode === "title"
        ? sqlWhereManualProductTitleAndSeller("r", 2, 3)
        : "TRUE";
  const scopeWhere = pq.manual ? `AND ${scopeF}` : "";

  const scopeParams =
    mode === "key" && pq.productKey
      ? [articleId, pq.productKey]
      : mode === "title"
        ? [articleId, pq.productTitle, pq.sellerOrNull]
        : [articleId];

  const sortRaw = typeof req.query.sort === "string" ? req.query.sort.trim() : "";
  const sortByProductKey = sortRaw === "product_key";
  const orderBy = sortByProductKey
    ? `(CASE WHEN NULLIF(trim(coalesce(r.product_key, '')), '') IS NULL THEN 1 ELSE 0 END) ASC,
       lower(trim(coalesce(r.product_key, ''))) ASC NULLS LAST,
       sr.executed_at DESC NULLS LAST,
       r.id DESC`
    : "sr.executed_at DESC NULLS LAST, r.id DESC";

  /** Tras $1 = search_id y filtros de alcance: índices de LIMIT / OFFSET. */
  const limitIdx = pq.manual ? (mode === "key" && pq.productKey ? 3 : 4) : 2;
  const offsetIdx = limitIdx + 1;
  const dataParams: unknown[] =
    mode === "key" && pq.productKey
      ? [articleId, pq.productKey, limit, offset]
      : mode === "title"
        ? [articleId, pq.productTitle, pq.sellerOrNull, limit, offset]
        : [articleId, limit, offset];

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM results r WHERE r.search_id = $1 ${scopeWhere}`,
    scopeParams,
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
    ORDER BY ${orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams,
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
