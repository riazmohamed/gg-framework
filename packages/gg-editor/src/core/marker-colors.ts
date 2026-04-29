/**
 * Marker color taxonomy.
 *
 * Resolve accepts 16 named colors via `Timeline.AddMarker(...)`. Premiere
 * exposes a numeric `colorIndex` 0–7 via `setColorByIndex(...)`. The 8 names
 * Premiere supports are the first half of Resolve's set plus `Orange` and
 * `White`.
 *
 * For Resolve-only colors (the 10 below 'white'), Premiere's bridge SNAPS to
 * the closest available index — same hue family. The mapping is documented
 * inline so both bridges agree.
 *
 * Sources:
 *   - Resolve: samuelgursky/davinci-resolve-mcp (verified against API docs)
 *   - Premiere: setColorByIndex 0–7 widely documented (varies by version,
 *     this is the common map)
 */

export const RESOLVE_MARKER_COLORS = [
  "Blue",
  "Cyan",
  "Green",
  "Yellow",
  "Red",
  "Pink",
  "Purple",
  "Fuchsia",
  "Rose",
  "Lavender",
  "Sky",
  "Mint",
  "Lemon",
  "Sand",
  "Cocoa",
  "Cream",
] as const;

export type ResolveMarkerColor = (typeof RESOLVE_MARKER_COLORS)[number];

/**
 * Premiere's 8-color colorIndex map. lowercase keys to match agent input.
 * The numeric values come from Premiere's TrackItemMarker.setColorByIndex.
 */
export const PREMIERE_COLOR_INDEX: Record<string, number> = {
  green: 0,
  red: 1,
  purple: 2,
  orange: 3,
  yellow: 4,
  white: 5,
  blue: 6,
  cyan: 7,
};

/**
 * For Resolve-only colors, snap to the closest Premiere index. Hue-grouped:
 *   pink/fuchsia/rose      → red (1)
 *   lavender/sky           → blue (6) / cyan (7)
 *   mint                   → green (0)
 *   lemon/sand/cocoa/cream → yellow (4) / white (5)
 */
export const RESOLVE_TO_PREMIERE_INDEX: Record<string, number> = {
  ...PREMIERE_COLOR_INDEX,
  pink: 1, // → red
  fuchsia: 2, // → purple
  rose: 1, // → red
  lavender: 2, // → purple
  sky: 7, // → cyan
  mint: 0, // → green
  lemon: 4, // → yellow
  sand: 4, // → yellow
  cocoa: 1, // → red (warm-brown family)
  cream: 5, // → white
};

/**
 * Normalize a user-provided color string to the form Resolve expects.
 * Returns the Title-Case Resolve name when known, otherwise the input
 * Title-Cased (Resolve will reject unknowns at the AddMarker call).
 */
export function toResolveColor(name: string): string {
  const lower = name.toLowerCase();
  for (const c of RESOLVE_MARKER_COLORS) {
    if (c.toLowerCase() === lower) return c;
  }
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
