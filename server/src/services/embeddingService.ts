import type { Pool } from "pg";

/** Normalización para texto enviado al modelo de embeddings (no es la misma que SQL `norm_title`). */
export function normalizeTitleForEmbedding(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/(oferta|nuevo|envio gratis|envío gratis|cuotas)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIM = 1536;

function embeddingModel(): string {
  return (process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function embeddingDim(): number {
  const n = Number(process.env.EMBEDDING_DIMENSIONS ?? process.env.EMBEDDING_DIM ?? DEFAULT_DIM);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DIM;
}

function openAiBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
}

function openAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

type OpenAiEmbeddingResponse = {
  data?: { embedding: number[]; index: number }[];
  error?: { message?: string };
};

/**
 * Una llamada a la API de embeddings (varios textos por request).
 * Respeta el orden de `inputs` en el resultado.
 */
export async function fetchEmbeddingsBatch(inputs: string[]): Promise<number[][]> {
  const key = openAiKey();
  if (!key) {
    throw new Error(
      "[embedding] Falta OPENAI_API_KEY (no se pueden generar embeddings).",
    );
  }
  if (inputs.length === 0) return [];

  const model = embeddingModel();
  const dimensions = embeddingDim();
  const url = `${openAiBaseUrl()}/embeddings`;
  const body: Record<string, unknown> = { model, input: inputs };
  if (model.startsWith("text-embedding-3")) {
    body.dimensions = dimensions;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as OpenAiEmbeddingResponse;
  if (!res.ok) {
    throw new Error(
      `[embedding] OpenAI HTTP ${res.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 400)}`,
    );
  }
  const rows = json.data ?? [];
  rows.sort((a, b) => a.index - b.index);
  const out = rows.map((r) => r.embedding);
  if (out.length !== inputs.length) {
    throw new Error(`[embedding] Se esperaban ${inputs.length} vectores, llegaron ${out.length}`);
  }
  for (const emb of out) {
    if (!Array.isArray(emb) || emb.length !== dimensions) {
      throw new Error(
        `[embedding] Dimensión inesperada (esperado ${dimensions}, obtuve ${emb?.length})`,
      );
    }
  }
  return out;
}

/** Serializa vector para PostgreSQL / pgvector. */
export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((x) => Number(x).toFixed(8)).join(",")}]`;
}

export async function upsertResultEmbedding(
  pool: Pool,
  resultId: number,
  embedding: number[],
): Promise<void> {
  const vec = vectorLiteral(embedding);
  await pool.query(
    `
    INSERT INTO result_embeddings (result_id, embedding, updated_at)
    VALUES ($1, $2::vector, now())
    ON CONFLICT (result_id) DO UPDATE SET
      embedding = EXCLUDED.embedding,
      updated_at = now()
    `,
    [resultId, vec],
  );
}

export type ResultTitleRow = { id: number; title: string };

/**
 * Resultados recientes (por `articles.article` y ventana) sin fila en `result_embeddings`.
 */
export async function fetchResultsMissingEmbeddings(
  pool: Pool,
  opts: { articleIlike: string; days: number; limit: number },
): Promise<ResultTitleRow[]> {
  const { rows } = await pool.query<ResultTitleRow>(
    `
    SELECT r.id, r.title
    FROM results r
    INNER JOIN scrape_runs sr ON sr.id = r.scrape_run_id
    INNER JOIN articles a ON a.id = r.search_id
    WHERE a.enabled = TRUE
      AND a.article ILIKE $1
      AND sr.executed_at >= NOW() - ($2::int * interval '1 day')
      AND r.title IS NOT NULL
      AND length(trim(r.title)) > 0
      AND NOT EXISTS (SELECT 1 FROM result_embeddings e WHERE e.result_id = r.id)
    ORDER BY r.id
    LIMIT $3
    `,
    [`%${opts.articleIlike}%`, opts.days, opts.limit],
  );
  return rows;
}
