import type { StackFrame } from "./types.js";

const FRAME_WITH_FN = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const FRAME_NO_FN = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const withFn = FRAME_WITH_FN.exec(line);
    if (withFn) {
      const file = withFn[2];
      frames.push({
        fn: withFn[1],
        file,
        line: Number(withFn[3]),
        col: Number(withFn[4]),
        in_app: isInApp(file),
      });
      continue;
    }
    const noFn = FRAME_NO_FN.exec(line);
    if (noFn) {
      const file = noFn[1];
      frames.push({
        fn: "<anon>",
        file,
        line: Number(noFn[2]),
        col: Number(noFn[3]),
        in_app: isInApp(file),
      });
    }
  }
  return frames;
}

function isInApp(file: string): boolean {
  if (!file) return false;
  if (file.startsWith("node:")) return false;
  if (file.startsWith("internal/")) return false;
  if (file.includes("/node_modules/")) return false;
  return true;
}
