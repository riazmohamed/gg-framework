import { z } from "zod";
import type { AgentTool } from "@abukhaled/gg-agent";
import { resolvePath, rejectSymlink } from "./path-utils.js";
import { localOperations, type ToolOperations } from "./operations.js";
import { assertFresh, recordWrite, type ReadTracker } from "./read-tracker.js";
import { goalModeRestriction, isGoalModeActive, type GoalMode } from "../core/runtime-mode.js";

type MutationCallback = (filePath: string) => void | Promise<void>;

function isMutationCallback(value: unknown): value is MutationCallback {
  return typeof value === "function";
}

const WriteParams = z.object({
  file_path: z.string().describe("The file path to write to"),
  content: z.string().describe("The content to write"),
});

export function createWriteTool(
  cwd: string,
  readFiles?: ReadTracker,
  ops: ToolOperations = localOperations,
  goalModeRefOrOnFileMutated?: { current: GoalMode } | MutationCallback,
  onFileMutated?: MutationCallback,
): AgentTool<typeof WriteParams> {
  const goalModeRef = isMutationCallback(goalModeRefOrOnFileMutated)
    ? undefined
    : goalModeRefOrOnFileMutated;
  const mutationCallback = isMutationCallback(goalModeRefOrOnFileMutated)
    ? goalModeRefOrOnFileMutated
    : onFileMutated;
  return {
    name: "write",
    description:
      "Write content to a file. Creates parent directories if needed. " +
      "Existing files must be read first before overwriting. Use for new files or complete rewrites.",
    parameters: WriteParams,
    executionMode: "sequential",
    async execute({ file_path, content }) {
      const resolved = resolvePath(cwd, file_path);
      await rejectSymlink(resolved);

      if (isGoalModeActive(goalModeRef)) {
        return goalModeRestriction("write", "Goal metadata, evidence plans, and task creation");
      }

      // Block overwriting existing files that haven't been read, or that
      // changed since the last read.
      if (readFiles) {
        const exists = await ops.stat(resolved).then(
          () => true,
          () => false,
        );
        if (exists) {
          await assertFresh(readFiles, resolved, ops);
        }
      }
      await ops.writeFile(resolved, content);
      await recordWrite(readFiles, resolved, content, ops);
      await mutationCallback?.(resolved);
      const lines = content.split("\n").length;
      return `Wrote ${lines} lines to ${resolved}`;
    },
  };
}
