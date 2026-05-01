import { createHash } from "node:crypto";
import type { StackFrame } from "./types.js";

export function fingerprint(type: string, stack: StackFrame[]): string {
  const top = stack[0];
  const normalized = top
    ? `${type}|${normalizeFile(top.file)}|${top.fn || "<anon>"}|${top.line}`
    : `${type}|<no-stack>`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function normalizeFile(file: string): string {
  return file
    .replace(/^file:\/\//, "")
    .replace(/^.*\/node_modules\//, "node_modules/")
    .replace(/\?.*$/, "");
}
