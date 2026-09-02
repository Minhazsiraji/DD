export const DEEPGRAM_TOKEN_REFRESH_SKEW_MS = 30_000;

const TOKEN_QA_DIAGNOSTICS = new Set([
  "TOKEN_ROUTE_UNAUTHORIZED",
  "TOKEN_ROUTE_FORBIDDEN",
  "TOKEN_RATE_LIMIT",
  "TOKEN_CONFIG_MISSING",
  "TOKEN_GRANT_REJECTED",
  "TOKEN_GRANT_NETWORK",
]);

export interface DeepgramAccessTokenGrant {
  accessToken: string;
  expiresAtMs: number;
  qaDiagnostics: boolean;
  source: "cache" | "network";
}

interface DeepgramTokenPayload {
  accessToken?: string;
  expiresIn?: number;
  diagnostic?: string;
  qaDiagnostics?: boolean;
}

interface CachedDeepgramToken {
  accessToken: string;
  expiresAtMs: number;
  qaDiagnostics: boolean;
}

let cachedToken: CachedDeepgramToken | null = null;
let inFlight: Promise<DeepgramAccessTokenGrant> | null = null;
let lifecycleBound = false;

function tokenQaDiagnostic(value: unknown): string | null {
  return typeof value === "string" && TOKEN_QA_DIAGNOSTICS.has(value) ? value : null;
}

function usableCachedToken(nowMs: number): CachedDeepgramToken | null {
  if (!cachedToken) return null;
  if (cachedToken.expiresAtMs - nowMs <= DEEPGRAM_TOKEN_REFRESH_SKEW_MS) {
    cachedToken = null;
    return null;
  }
  return cachedToken;
}

/**
 * Preview-pilot cache only: page memory, never Web Storage/cookies/DB.
 * Page lifecycle teardown clears it; otherwise actual provider expiry bounds it.
 */
export function clearDeepgramAccessTokenCache() {
  cachedToken = null;
  inFlight = null;
}

function bindLifecycleClear() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  window.addEventListener("pagehide", clearDeepgramAccessTokenCache, { passive: true });
}

export function peekDeepgramTokenCache(nowMs = Date.now()): {
  usable: boolean;
  expiresInMs: number;
} {
  const token = usableCachedToken(nowMs);
  return {
    usable: token !== null,
    expiresInMs: token ? Math.max(0, token.expiresAtMs - nowMs) : 0,
  };
}

export async function getDeepgramAccessToken({
  signal,
  forceRefresh = false,
  fetchImpl = fetch,
  now = () => Date.now(),
}: {
  signal?: AbortSignal;
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}): Promise<DeepgramAccessTokenGrant> {
  bindLifecycleClear();

  if (forceRefresh) clearDeepgramAccessTokenCache();

  const existing = usableCachedToken(now());
  if (existing) {
    return { ...existing, source: "cache" };
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetchImpl("/api/voice/token", {
      method: "POST",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });

    let payload: DeepgramTokenPayload = {};
    try {
      payload = (await response.json()) as DeepgramTokenPayload;
    } catch {}

    if (!response.ok) {
      const diagnostic = tokenQaDiagnostic(payload.diagnostic);
      if (diagnostic) throw new Error(diagnostic);
      throw new Error(response.status === 503 ? "provider-unavailable" : "provider-error");
    }
    if (!payload.accessToken) throw new Error("provider-error");

    const expiresInSeconds = Math.max(1, Number(payload.expiresIn ?? 30));
    const token: CachedDeepgramToken = {
      accessToken: payload.accessToken,
      expiresAtMs: now() + expiresInSeconds * 1000,
      qaDiagnostics: payload.qaDiagnostics === true,
    };
    cachedToken = token;
    return { ...token, source: "network" as const };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
