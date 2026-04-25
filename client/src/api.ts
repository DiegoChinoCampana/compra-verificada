/** Base opcional para la API (mismo u otro origen). Debe ser origen o URL absoluta; si incluye path, se ignora al unir con rutas que empiezan en `/`. */
const rawApiBase = (import.meta.env.VITE_API_URL ?? "").trim();

/** En prod (p. ej. Vercel) el primer /api puede tardar por cold start + Postgres remoto. */
const DEFAULT_TIMEOUT_MS = import.meta.env.PROD ? 120_000 : 60_000;

/** Evita URLs rotas tipo `https://host/articulos/24` + `/api/...` → path incorrecto. */
function resolveRequestUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!rawApiBase) return p;
  try {
    return new URL(p, rawApiBase.endsWith("/") ? rawApiBase : `${rawApiBase}/`).toString();
  } catch {
    return `${rawApiBase.replace(/\/+$/, "")}${p}`;
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const c = new AbortController();
  const onAbort = () => c.abort();
  for (const s of signals) {
    if (s.aborted) {
      c.abort();
      return c.signal;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return c.signal;
}

export type FetchJsonOptions = {
  /** Por defecto usa el tope global (más alto en prod por cold start). */
  timeoutMs?: number;
};

/** fetch JSON con tope de tiempo; si pasás `signal` en init, también se cancela al abortar ese signal. */
export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  opts?: FetchJsonOptions,
): Promise<T> {
  const url = resolveRequestUrl(path);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = new AbortController();
  const tid = setTimeout(() => timeout.abort(), timeoutMs);

  const merged =
    init?.signal != null
      ? anySignal([init.signal, timeout.signal])
      : timeout.signal;

  try {
    const r = await fetch(url, { ...init, signal: merged });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || r.statusText);
    }
    return r.json() as Promise<T>;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      const hint =
        init?.signal?.aborted
          ? "Solicitud cancelada."
          : import.meta.env.DEV
            ? `La API no respondió en ${timeoutMs / 1000}s. En local: levantá el backend (puerto 3001) o usá «npm run dev» desde la raíz del monorepo (api + web). URL: ${url}`
            : `La API no respondió en ${timeoutMs / 1000}s. Revisá en Vercel la función /api, variables DATABASE_URL y logs. URL: ${url}`;
      throw new Error(hint);
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }
}
