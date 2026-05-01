import { readFileSync, existsSync } from "node:fs";
import type { CodeContext, StackFrame } from "./core/types.js";

const WINDOW = 2;
const cache = new Map<string, string[] | null>();

export function captureCodeContext(stack: StackFrame[]): CodeContext | null {
  const top = stack.find((f) => isReadable(f.file));
  if (!top) return null;
  const lines = loadLines(top.file);
  if (!lines) return null;
  const start = Math.max(0, top.line - 1 - WINDOW);
  const end = Math.min(lines.length, top.line + WINDOW);
  return {
    file: top.file,
    error_line: top.line,
    lines: lines.slice(start, end),
  };
}

function isReadable(file: string): boolean {
  if (!file || file.startsWith("node:")) return false;
  if (file.includes("/node_modules/")) return false;
  return file.startsWith("/") || file.startsWith("file://");
}

function loadLines(file: string): string[] | null {
  const path = file.replace(/^file:\/\//, "");
  if (cache.has(path)) return cache.get(path) ?? null;
  if (!existsSync(path)) {
    cache.set(path, null);
    return null;
  }
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    cache.set(path, lines);
    return lines;
  } catch {
    cache.set(path, null);
    return null;
  }
}
