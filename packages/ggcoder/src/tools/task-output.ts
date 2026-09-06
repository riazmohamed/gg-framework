import { z } from "zod";
import type { AgentTool } from "@abukhaled/gg-agent";
import { MAX_PROCESS_WAIT_MS, type ProcessManager } from "../core/process-manager.js";
import { truncateTail } from "./truncate.js";
import { compressToolOutput } from "./compress.js";
import { writeOverflow } from "./overflow.js";

const TaskOutputParams = z.object({
  id: z.string().describe("The background process ID"),
  from_start: z
    .boolean()
    .optional()
    .describe("If true, read output from the beginning instead of incrementally"),
  wait_ms: z
    .number()
    .int()
    .min(1000)
    .max(MAX_PROCESS_WAIT_MS)
    .optional()
    .describe(
      `Block until the process exits, up to this many ms (max ${MAX_PROCESS_WAIT_MS}), then ` +
        "read. Returns the moment it finishes — use this instead of sleeping for a " +
        "guessed duration when you have nothing else to do until it is done.",
    ),
});

export function createTaskOutputTool(
  processManager: ProcessManager,
): AgentTool<typeof TaskOutputParams> {
  return {
    name: "task_output",
    description:
      "Read output from a background process. Returns new output since last read by default. " +
      "Use from_start=true to read from the beginning. Progress and exit status arrive " +
      "automatically for background processes \u2014 call this when you need the full output, " +
      "not merely to check whether something finished. Set wait_ms to block until the " +
      "process exits rather than sleeping for a guessed duration (wait_agent is for child " +
      "agents, not background processes).",
    parameters: TaskOutputParams,
    // wait_ms can block past the loop's default per-tool ceiling, so declare the
    // real budget rather than being cancelled mid-wait.
    timeoutMs: MAX_PROCESS_WAIT_MS + 30_000,
    async execute({ id, from_start, wait_ms }, context) {
      let waitNotice = "";
      if (wait_ms !== undefined) {
        const reason = await processManager.waitForExit(id, wait_ms, context?.signal);
        if (reason === "timeout") {
          waitNotice = ` — still running after waiting ${Math.round(wait_ms / 1000)}s`;
        }
      }
      const result = await processManager.readOutput(id, from_start);

      const status =
        (result.isRunning ? "running" : `exited (code ${result.exitCode})`) + waitNotice;

      let output = result.output;
      if (output) {
        const truncated = truncateTail(output);
        if (truncated.truncated) {
          // Over-limit: compress (keeps errors + head/tail) rather than a blind
          // tail slice; overflow file preserves the full original.
          const overflowPath = await writeOverflow(output, "task-output").catch(() => null);
          const overflowNotice = overflowPath ? ` Full output: ${overflowPath}` : "";
          const c = compressToolOutput(output);
          output = `[${c.notice}${overflowNotice}]\n${c.content}`;
        } else {
          output = truncated.content;
        }
      } else {
        output = "(no new output)";
      }

      return `Process ${id}: ${status}\n${output}`;
    },
  };
}
