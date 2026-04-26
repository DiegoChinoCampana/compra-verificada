import type { Pool } from "pg";

/** Fila reservada en `configs` para la última corrida del script `clusterProducts.ts`. */
export const CLUSTER_BATCH_CONFIG_ID = 100;
export const CLUSTER_BATCH_CONFIG_NAME = "cluster_batch_last";

export type ClusterBatchMetaPayload = {
  finishedAt: string;
  article: string;
  days: number;
  embedded: number;
  clusteredRows: number;
  inCluster: number;
  noise: number;
  minSimilarity: number;
  minPts: number;
  /** Similitud mínima entre centroides para fusionar clusters post-DBSCAN. */
  centroidMergeMinSimilarity?: number;
  /** Si true, no se aplica la fusión por centroides. */
  skipCentroidMerge?: boolean;
  /** Si true, se limpiaron claves en todo el artículo+ventana antes de agrupar. */
  resetArticleWindow?: boolean;
  resetScope: boolean;
  durationMs: number;
};

export async function readClusterBatchMeta(pool: Pool): Promise<ClusterBatchMetaPayload | null> {
  const { rows } = await pool.query<{ value: string | null }>(
    "SELECT value FROM configs WHERE id = $1",
    [CLUSTER_BATCH_CONFIG_ID],
  );
  const raw = rows[0]?.value;
  if (!raw || !String(raw).trim()) return null;
  try {
    return JSON.parse(String(raw)) as ClusterBatchMetaPayload;
  } catch {
    return null;
  }
}

export async function writeClusterBatchMeta(
  pool: Pool,
  payload: ClusterBatchMetaPayload,
): Promise<void> {
  await pool.query(
    `INSERT INTO configs (id, name, value)
     VALUES ($1, $2, $3::text)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       value = EXCLUDED.value`,
    [CLUSTER_BATCH_CONFIG_ID, CLUSTER_BATCH_CONFIG_NAME, JSON.stringify(payload)],
  );
}
