/**
 * Protección del endpoint que dispara clustering (OpenAI + escritura en DB).
 * En Vercel es obligatorio definir `CLUSTER_BATCH_SECRET`.
 * Fuera de Vercel, si no hay secreto configurado, se permite (desarrollo local).
 */
export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL?.trim());
}

export function clusterBatchSecretConfigured(): boolean {
  return Boolean(process.env.CLUSTER_BATCH_SECRET?.trim());
}

/** Si el cliente debe enviar token para que el POST sea aceptado. */
export function clusterBatchRequiresClientSecret(): boolean {
  return isVercelRuntime() || clusterBatchSecretConfigured();
}

/**
 * @throws Error con propiedad opcional `status` (HTTP).
 */
export function assertClusterBatchAuthorized(secretFromClient: unknown): void {
  if (isVercelRuntime() && !clusterBatchSecretConfigured()) {
    const err = new Error(
      "En Vercel hay que definir CLUSTER_BATCH_SECRET en las variables de entorno del proyecto.",
    );
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  const expected = process.env.CLUSTER_BATCH_SECRET?.trim();
  if (!expected) return;
  const got = typeof secretFromClient === "string" ? secretFromClient.trim() : "";
  if (got !== expected) {
    const err = new Error("Token de clustering incorrecto o ausente.");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}
