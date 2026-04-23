import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { articlesRouter } from "./routes/articles.js";
import { analyticsRouter } from "./routes/analytics.js";
import { reportRouter } from "./routes/report.js";
import { analysisRouter } from "./routes/analysis.js";
import { resultsRouter } from "./routes/results.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(503).json({ ok: false, db: false, error: String(e) });
  }
});

app.use("/api/articles", articlesRouter);
app.use("/api/results", resultsRouter);
app.use("/api/analysis", analysisRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/report", reportRouter);
