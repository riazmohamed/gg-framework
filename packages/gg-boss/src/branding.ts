export const VERSION = "0.1.0";
export const BRAND = "GG Boss";
export const AUTHOR = "Ken Kai";

export const LOGO_LINES: readonly string[] = [" ▄▀▀▀ ▄▀▀▀", " █ ▀█ █ ▀█", " ▀▄▄▀ ▀▄▄▀"];

export const LOGO_GAP = "   ";

export const GRADIENT: readonly string[] = [
  "#60a5fa",
  "#6da1f9",
  "#7a9df7",
  "#8799f5",
  "#9495f3",
  "#a18ff1",
  "#a78bfa",
  "#a18ff1",
  "#9495f3",
  "#8799f5",
  "#7a9df7",
  "#6da1f9",
];

export const COLORS = {
  primary: "#60a5fa",
  accent: "#a78bfa",
  text: "#e2e8f0",
  textDim: "#6b7280",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#f87171",
} as const;

/** Clear the entire scrollback + visible screen and reset cursor to home. */
export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}
