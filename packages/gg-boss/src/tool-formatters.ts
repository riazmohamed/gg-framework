import type { ToolExecutionFormatters } from "@kenkaiiii/ggcoder/ui";

function truncate(s: string, max: number): string {
  if (max <= 1) return "…";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Hex palette for the prompt_worker inline badge. Picked to look decent in both
 * dark and light themes — saturated enough to read on dim backgrounds, soft
 * enough not to scream.
 */
const INLINE_COLORS = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#4ade80", // green
  "#fbbf24", // amber
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#34d399", // emerald
];

/** Stable hash over a string — same args always pick the same color. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickColor(seed: string): string {
  return INLINE_COLORS[hash(seed) % INLINE_COLORS.length]!;
}

/**
 * Compute how many chars of the prompt-worker message detail can fit on a
 * single line of the current terminal. Header chrome ≈ "⏺ Prompt Worker(<proj>
 *  · …) <inline>" — we subtract the fixed pieces so the message gets whatever
 * room remains.
 */
function promptWorkerDetailLen(project: string): number {
  const cols = process.stdout.columns ?? 80;
  // Fixed overhead estimate: dot(2) + label "Prompt Worker"(13) + "("(1)
  // + project + " · "(3) + ")"(1) + " "(1) + " dispatched"(11) + safety(6).
  const fixed = 2 + 13 + 1 + project.length + 3 + 1 + 1 + 11 + 6;
  return Math.max(20, cols - fixed);
}

/**
 * Custom label / detail / inline-summary rendering for the boss's own tools.
 * Falls through to ggcoder's defaults for anything else.
 */
export const bossToolFormatters: ToolExecutionFormatters = {
  formatLabel(name) {
    switch (name) {
      case "list_workers":
        return "List Workers";
      case "get_worker_status":
        return "Worker Status";
      case "prompt_worker":
        return "Prompt Worker";
      case "get_worker_summary":
        return "Worker Summary";
      default:
        return undefined;
    }
  },

  formatDetail(name, args) {
    switch (name) {
      case "list_workers":
        return "";
      case "get_worker_status":
      case "get_worker_summary":
        return truncate(String(args.project ?? ""), 40);
      case "prompt_worker": {
        const project = String(args.project ?? "");
        const message = String(args.message ?? "").replace(/\s+/g, " ");
        const fresh = args.fresh === true;
        const maxMsg = promptWorkerDetailLen(project) - (fresh ? 8 : 0); // "fresh · " is 8 chars
        const truncMsg = truncate(message, Math.max(15, maxMsg));
        const head = fresh ? "fresh · " : "";
        return project ? `${head}${project} · ${truncMsg}` : `${head}${truncMsg}`;
      }
      default:
        return undefined;
    }
  },

  formatInline(name, result, isError) {
    if (isError) return undefined;
    switch (name) {
      case "list_workers": {
        const lines = result.split("\n").filter((l) => l.startsWith("-"));
        return `${lines.length} worker${lines.length === 1 ? "" : "s"}`;
      }
      case "prompt_worker": {
        if (result.includes("currently working")) {
          return { text: "busy — skipped", color: "#fbbf24" };
        }
        if (result.includes("Unknown project")) {
          return { text: "unknown project", color: "#f87171" };
        }
        // "Fresh session opened…" → distinct badge so direction-change
        // prompts visibly stand out from continuation prompts.
        if (result.startsWith("Fresh session opened")) {
          return { text: "dispatched · fresh", color: pickColor(result) };
        }
        // Hash on the result — same prompt → same color, but different prompts
        // get different colors so successive Prompt Worker rows stay lively.
        return { text: "dispatched", color: pickColor(result) };
      }
      case "get_worker_status": {
        const parts = result.split(":");
        return parts.length >= 2 ? parts.slice(1).join(":").trim() : undefined;
      }
      case "get_worker_summary": {
        const turnMatch = result.match(/Turn:\s*(\d+)/);
        const toolsMatch = result.match(/Tools used:\s*(.+)/);
        const tools = toolsMatch ? toolsMatch[1] : "";
        const toolCount = tools && tools !== "(no tools used)" ? tools.split(",").length : 0;
        const turn = turnMatch ? `turn ${turnMatch[1]}` : undefined;
        const tCount = toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : undefined;
        return [turn, tCount].filter(Boolean).join(" · ") || undefined;
      }
      default:
        return undefined;
    }
  },
};
