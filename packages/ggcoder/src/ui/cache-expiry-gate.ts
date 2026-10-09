import {
  assessCacheExpiry,
  resolveCacheTtl,
  type CacheExpiryStatus,
  type CacheTouch,
} from "../core/cache-expiry.js";

export interface CacheRoute {
  provider: string;
  model: string;
  baseUrl?: string;
  accountId?: string;
}

/** Record a successful request: the prefix is warm for this route's TTL. */
export function cacheTouchFor(route: CacheRoute, at: number): CacheTouch | null {
  const policy = resolveCacheTtl({ ...route, cacheRetention: "short" });
  return policy ? { at, provider: route.provider, model: route.model, policy } : null;
}

export function assessTuiCacheExpiry(
  route: CacheRoute,
  lastTouch: CacheTouch | null,
  prefixTokens: number,
  hasHistory: boolean,
  now: number,
): CacheExpiryStatus | null {
  return assessCacheExpiry({
    current: {
      provider: route.provider,
      model: route.model,
      policy: resolveCacheTtl({ ...route, cacheRetention: "short" }),
    },
    lastTouch,
    now,
    prefixTokens,
    hasHistory,
  });
}

/** One key per lapse, so the warning shows once and a second Enter sends. */
export function cacheExpiryKey(status: CacheExpiryStatus): string {
  return `${status.provider}:${status.lastRequestAt ?? "unknown"}:${status.reason ?? ""}`;
}

function ago(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `~${Math.round(n / 1000)}k`;
}

/**
 * The desktop's cold-cache strip as one line: why the prompt cache is cold, the
 * size of the full-price re-read, and the two ways forward. Null when the
 * lapse is not worth interrupting for (`notable` is false).
 */
export function cacheExpiryWarning(status: CacheExpiryStatus | null, now: number): string | null {
  if (!status?.notable) return null;
  const verb = status.confidence === "may_be_cold" ? "may have expired" : "expired";
  const when = status.expiresAt ? ` ${ago(now - status.expiresAt)} ago` : "";
  const lead =
    status.reason === "identity_changed"
      ? "The model changed since the last request, so the prompt cache can't be reused."
      : status.reason === "age_unknown"
        ? "This chat has no warm prompt cache yet (it was resumed or reset)."
        : `The prompt cache ${verb}${when}.`;
  return (
    `${lead} Sending re-reads ${tokens(status.prefixTokens)} tokens at full price. ` +
    "Press Enter again to send anyway, or run /compact first."
  );
}
