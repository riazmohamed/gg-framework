/**
 * Xiaomi MiMo token-plan region endpoints.
 *
 * Xiaomi issues API keys that are scoped to a specific region. A key created
 * in the Amsterdam dashboard will return 401 "Invalid API Key" on the Singapore
 * endpoint (and vice versa), so the correct regional base URL must be stored
 * alongside the key at login time.
 *
 * Only regions verified against live endpoints are listed here. To add a new
 * region, verify the URL resolves and accepts a valid key before adding it.
 */

export interface XiaomiRegionInfo {
  /** Human-readable label for selectors. */
  label: string;
  /** Full base URL including `/v1` path, suitable for OpenAI-compatible clients. */
  baseUrl: string;
}

export const XIAOMI_REGIONS = {
  ams: {
    label: "Amsterdam (EU)",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  },
  sgp: {
    label: "Singapore (APAC)",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  },
} as const satisfies Record<string, XiaomiRegionInfo>;

export type XiaomiRegion = keyof typeof XIAOMI_REGIONS;

/** Ordered list of region ids, used by UI selectors. */
export const XIAOMI_REGION_IDS: readonly XiaomiRegion[] = ["ams", "sgp"];

/** Returns the base URL for a known Xiaomi region. */
export function getXiaomiBaseUrl(region: XiaomiRegion): string {
  return XIAOMI_REGIONS[region].baseUrl;
}

/** Type guard — true if `value` is a recognized Xiaomi region id. */
export function isXiaomiRegion(value: unknown): value is XiaomiRegion {
  return typeof value === "string" && value in XIAOMI_REGIONS;
}
