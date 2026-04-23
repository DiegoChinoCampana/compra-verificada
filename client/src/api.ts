const base = import.meta.env.VITE_API_URL ?? "";

const DEFAULT_TIMEOUT_MS = 60_000;

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

/** fetch JSON con tope de tiempo; si pasás `signal` en init, también se cancela al abortar ese signal. */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const timeout = new AbortController();
  const tid = setTimeout(() => timeout.abort(), DEFAULT_TIMEOUT_MS);

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
      throw new Error(
        init?.signal?.aborted
          ? "Solicitud cancelada."
          : `La API no respondió en ${DEFAULT_TIMEOUT_MS / 1000}s (¿corre el servidor en :3001?).`,
      );
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }
}
