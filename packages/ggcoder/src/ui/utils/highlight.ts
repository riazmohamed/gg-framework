import path from "node:path";

/** Map file extension to cli-highlight language name */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  html: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  toml: "ini",
  dockerfile: "dockerfile",
};

/** Get language from a file path's extension */
export function langFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return EXT_TO_LANG[ext];
}

interface HighlightModule {
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): string;
  supportsLanguage(lang: string): boolean;
}

// Lazy-load cli-highlight so it doesn't block initial render.
// First call returns plain text; subsequent calls use the loaded highlighter.
let hlModule: HighlightModule | undefined;
let loadAttempted = false;

function ensureLoaded(): HighlightModule | undefined {
  if (hlModule) return hlModule;
  if (loadAttempted) return undefined;
  loadAttempted = true;
  // Kick off async load for next call
  import("cli-highlight").then(
    (m) => {
      // esbuild wraps CJS deps as `{ default: <exports> }`, while Node's
      // direct CJS-from-ESM import exposes named exports on the namespace.
      // Handle both shapes.
      const candidate = m as unknown as Partial<HighlightModule> & {
        default?: HighlightModule;
      };
      hlModule =
        typeof candidate.supportsLanguage === "function"
          ? (candidate as HighlightModule)
          : candidate.default;
    },
    () => {
      // Failed to load — will fall back to plain text permanently
    },
  );
  return undefined;
}

/**
 * Syntax-highlight code. Returns ANSI string.
 * Falls back to raw code if the highlighter hasn't loaded yet or language is unknown.
 */
export function highlightCode(code: string, language?: string): string {
  if (!language) return code;
  const hl = ensureLoaded();
  if (!hl || !hl.supportsLanguage(language)) return code;
  try {
    return hl.highlight(code, { language, ignoreIllegals: true });
  } catch {
    return code;
  }
}
