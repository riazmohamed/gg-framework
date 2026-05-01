import type { StackFrame } from "./types.js";

/**
 * Cross-browser stack-trace parser.
 *
 * Browser stack formats differ wildly. We support two — that covers
 * Chrome/Edge/Safari (V8-shaped) and Firefox (Gecko-shaped). Real-world
 * coverage cited by Sentry's parsers in `packages/browser/src/stack-parsers.ts`.
 */

// Chrome / V8 / Edge / modern Safari. Examples:
//   "    at fnName (https://app.com/main.js:42:13)"
//   "    at https://app.com/main.js:42:13"
//   "    at fnName (eval at <anonymous> (https://x/y.js:1:1), <anonymous>:1:5)"
const CHROME_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))(?:\))?\s*$/;

// Firefox / Gecko. Examples:
//   "fnName@https://app.com/main.js:42:13"
//   "@https://app.com/main.js:42:13"
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+)(?::(\d+))?\s*$/;

export function parseBrowserStack(stack: string | undefined, sameOrigin?: string): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip the leading "TypeError: x" header line — no `at` prefix and no `@`.
    if (!/^(?:at\s|.*@)/.test(trimmed)) continue;

    const chrome = CHROME_FRAME.exec(line);
    if (chrome) {
      const fn = (chrome[1] ?? "").trim() || "<anon>";
      const file = chrome[2];
      if (!file) continue;
      frames.push({
        fn,
        file,
        line: Number(chrome[3]),
        col: Number(chrome[4]),
        in_app: isInApp(file, sameOrigin),
      });
      continue;
    }

    const gecko = GECKO_FRAME.exec(line);
    if (gecko) {
      const fn = (gecko[1] ?? "").trim() || "<anon>";
      const file = gecko[2];
      if (!file) continue;
      frames.push({
        fn,
        file,
        line: Number(gecko[3]),
        col: gecko[4] ? Number(gecko[4]) : 0,
        in_app: isInApp(file, sameOrigin),
      });
    }
  }
  return frames;
}

/**
 * Mark a frame as in-app when its URL matches the page's origin (or other
 * provided origin). Cross-origin scripts (CDN bundles, third-party widgets,
 * browser extensions) are framework/library noise — not the user's code.
 */
function isInApp(file: string, sameOrigin?: string): boolean {
  if (!file) return false;
  // Browser-extension and inline-eval frames — never user code.
  if (/^chrome-extension:\/\//.test(file)) return false;
  if (/^moz-extension:\/\//.test(file)) return false;
  if (/^safari-extension:\/\//.test(file)) return false;
  if (/^webkit-masked-url:\/\//.test(file)) return false;
  if (file === "<anonymous>" || file === "[native code]") return false;

  if (!sameOrigin) {
    // No origin context — best-effort: any http(s) URL counts as in_app
    // unless we can prove otherwise.
    return /^https?:\/\//.test(file) || /^[a-z]+:\/\//.test(file) === false;
  }

  try {
    const url = new URL(file, sameOrigin);
    return url.origin === sameOrigin;
  } catch {
    return false;
  }
}
