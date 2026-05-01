import type { StackFrame } from "./types.js";

/**
 * Browser-safe synchronous fingerprint.
 *
 * `node:crypto` doesn't exist in browsers, and Web Crypto's `subtle.digest`
 * is async — making the queue async would break the fast-path. Sentry's
 * browser SDK uses simple sync hashing for the same reason. Our fingerprint
 * just needs to be stable for the same inputs; cryptographic strength isn't
 * required.
 *
 * Implementation: FNV-1a 64-bit. Fast, sync, ~1KB. Output as 16-char hex.
 */
export function fingerprintWeb(type: string, stack: StackFrame[]): string {
  const top = stack[0];
  const normalized = top
    ? `${type}|${normalizeFile(top.file)}|${top.fn || "<anon>"}|${top.line}`
    : `${type}|<no-stack>`;
  return fnv1a64(normalized);
}

/** FNV-1a 64-bit hash. Returns 16-char lowercase hex. */
export function fnv1a64(input: string): string {
  // 64-bit math via two 32-bit halves, since JS doesn't have native u64.
  // Constants from the FNV-1a spec.
  let hHi = 0xcbf29ce4;
  let hLo = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    hLo ^= code & 0xff;
    if (input.charCodeAt(i) > 0xff) hHi ^= (code >>> 8) & 0xff;

    // h = h * 0x100000001b3 (FNV prime), as 64-bit math:
    // The prime split into hi/lo 32-bit parts is { 0x100, 0x000001b3 }.
    const lo16 = hLo & 0xffff;
    const lo32 = (hLo >>> 16) & 0xffff;
    const hi16 = hHi & 0xffff;
    const hi32 = (hHi >>> 16) & 0xffff;

    let nLo = lo16 * 0x1b3;
    let nMid = lo32 * 0x1b3 + ((nLo >>> 16) & 0xffff);
    let nHi = hi16 * 0x1b3 + ((nMid >>> 16) & 0xffff);
    let nTop = hi32 * 0x1b3 + ((nHi >>> 16) & 0xffff);

    nLo += lo16 * 0; // *= 0x100... carry from low parts
    nMid += lo32 * 0;
    nHi += hi16 * 0;
    nTop += hi32 * 0;

    // Add the * 0x1_00000000_00 portion (lo16 << 32).
    nHi += lo16;
    nTop += lo32 + ((nHi >>> 16) & 0xffff);

    hLo = (((nMid & 0xffff) << 16) | (nLo & 0xffff)) >>> 0;
    hHi = (((nTop & 0xffff) << 16) | (nHi & 0xffff)) >>> 0;
  }

  return toHex32(hHi) + toHex32(hLo);
}

function toHex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

function normalizeFile(file: string): string {
  return file.replace(/\?.*$/, "").replace(/#.*$/, "");
}
