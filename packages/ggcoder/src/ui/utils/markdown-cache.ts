const MAX_SIZE = 500;

/**
 * cyrb53 — fast 53-bit non-cryptographic string hash.
 * ~50–100× faster than SHA-256 for cache keying. Collision risk is
 * negligible at our 500-entry working set.
 * https://stackoverflow.com/a/52171480
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** LRU cache for rendered markdown ANSI strings, scoped by theme + width. */
class MarkdownAnsiCache {
  private cache = new Map<string, string>();

  get(body: string, themeName: string, columns: number): string | undefined {
    const key = this.key(body, themeName, columns);
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(body: string, themeName: string, columns: number, ansi: string): void {
    const key = this.key(body, themeName, columns);
    this.cache.delete(key);
    this.cache.set(key, ansi);
    if (this.cache.size > MAX_SIZE) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
  }

  private key(body: string, themeName: string, columns: number): string {
    return `${themeName}:${columns}:${cyrb53(body)}`;
  }
}

export const markdownAnsiCache = new MarkdownAnsiCache();

/**
 * Check whether text contains markdown syntax worth parsing.
 * If it doesn't, the caller can skip marked.lexer() entirely.
 * Matches Claude Code's MD_SYNTAX_RE patterns.
 */
const MARKDOWN_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /m;

export function containsMarkdownSyntax(text: string): boolean {
  // Only check the first 500 chars for performance
  const sample = text.length > 500 ? text.slice(0, 500) : text;
  return MARKDOWN_SYNTAX_RE.test(sample);
}
