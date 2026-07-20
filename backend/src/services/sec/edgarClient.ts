/** Slots are reserved before waiting, so concurrent callers still space
 * request starts by the interval — under SEC's 10 requests/second cap. */
const minRequestIntervalMs = 125;
const retryDelayMs = 2_000;
const maxAttempts = 3;

export interface EdgarClient {
  fetchJson<T>(url: string): Promise<T>;
  /** Resolves null when the document does not exist (HTTP 404). */
  fetchText(url: string): Promise<string | null>;
}

export function createEdgarClient(userAgent: string): EdgarClient {
  let nextAllowedMs = 0;

  async function fetchThrottled(url: string): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const slotMs = Math.max(nextAllowedMs, Date.now());
      nextAllowedMs = slotMs + minRequestIntervalMs;
      const waitMs = slotMs - Date.now();
      if (waitMs > 0) {
        await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      }
      let response: Response;
      try {
        response = await fetch(url, { headers: { "User-Agent": userAgent } });
      } catch (error) {
        if (attempt >= maxAttempts) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`EDGAR request failed for ${url}: ${reason}`);
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, retryDelayMs * attempt));
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        return response;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, retryDelayMs * attempt));
    }
  }

  return {
    async fetchJson<T>(url: string): Promise<T> {
      const response = await fetchThrottled(url);
      if (!response.ok) {
        throw new Error(`EDGAR request failed: HTTP ${response.status} for ${url}`);
      }
      return (await response.json()) as T;
    },
    async fetchText(url: string): Promise<string | null> {
      const response = await fetchThrottled(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`EDGAR request failed: HTTP ${response.status} for ${url}`);
      }
      return response.text();
    },
  };
}
