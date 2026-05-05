/**
 * Stable project-color palette. Hashing the project name to a fixed slot lets
 * every UI surface (worker event row, status bar, scope pill, dispatched
 * badge, etc.) tag the same project with the same hue — turns scrollback into
 * a glanceable colour-coded timeline.
 *
 * Picked to look decent in both dark and light themes — saturated enough to
 * read on dim backgrounds, soft enough not to scream.
 */
export const PROJECT_COLORS: readonly string[] = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#4ade80", // green
  "#fbbf24", // amber
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#34d399", // emerald
];

export function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Pick a color for a project — same project name always returns the same color. */
export function projectColor(name: string): string {
  return PROJECT_COLORS[stableHash(name) % PROJECT_COLORS.length]!;
}
