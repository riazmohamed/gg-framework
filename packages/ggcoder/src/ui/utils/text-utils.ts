import { stripVTControlCharacters } from "node:util";
import stripAnsi from "strip-ansi";

/**
 * Strip characters that can break terminal rendering.
 *
 * Mirrors Gemini CLI's display sanitization: strip ANSI, unsafe C0/C1,
 * BiDi/zero-width controls, then any remaining VT control sequences.
 */
export function stripUnsafeCharacters(str: string): string {
  const strippedAnsi = stripAnsi(str);
  const strippedWithRegex = strippedAnsi.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x80-\x9F\u200E\u200F\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g,
    "",
  );
  return stripVTControlCharacters(strippedWithRegex);
}
