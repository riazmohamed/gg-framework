import { writeFileSync } from "node:fs";
import type { Message, TextContent, ImageContent } from "@abukhaled/gg-ai";
import type { ImageAttachment } from "../utils/image.js";
import { PROMPT_COMMANDS, getPromptCommand } from "../core/prompt-commands.js";
import type { CustomCommand } from "../core/custom-commands.js";
import type { GoalMode } from "../core/runtime-mode.js";
import type { UserContent } from "./hooks/useAgentLoop.js";

export function routePromptCommandInput(
  input: string,
  promptCommands = PROMPT_COMMANDS,
  customCommands: Pick<CustomCommand, "name" | "prompt">[] = [],
): { cmdName: string; cmdArgs: string; promptText: string; fullPrompt: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(" ");
  const cmdName = parts[0];
  const cmdArgs = parts.slice(1).join(" ").trim();
  const builtinCmd = promptCommands.find((c) => c.name === cmdName || c.aliases.includes(cmdName));
  const customCmd = !builtinCmd ? customCommands.find((c) => c.name === cmdName) : undefined;
  const promptText = builtinCmd?.prompt ?? customCmd?.prompt;
  if (!promptText) return null;
  return {
    cmdName,
    cmdArgs,
    promptText,
    fullPrompt: cmdArgs ? `${promptText}\n\n## User Instructions\n\n${cmdArgs}` : promptText,
  };
}

const GOAL_PLANNER_OUTPUT_MAX_CHARS = 2400;
const GOAL_PLAN_BLOCK_PATTERN = /^GOAL_PLAN\s*$[\s\S]*?^END_GOAL_PLAN\s*$/m;
const USER_INSTRUCTIONS_HEADING_PATTERN = /^## User Instructions\s*$/m;
const GOAL_REFERENCES_HEADING_PATTERN = /^## Goal References \(MANDATORY\)\s*$/m;

function messageTextContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function collectAssistantTextSince(
  messages: readonly Message[],
  startIndex: number,
  maxChars = GOAL_PLANNER_OUTPUT_MAX_CHARS,
): string {
  const text = messages
    .slice(startIndex)
    .filter((message) => message.role === "assistant")
    .map(messageTextContent)
    .join("\n")
    .trim();
  const goalPlanBlock = text.match(GOAL_PLAN_BLOCK_PATTERN)?.[0]?.trim();
  if (goalPlanBlock) return goalPlanBlock;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "\n[planner output truncated]";
}

function compactOriginalGoalPromptForSetup(originalGoalPrompt: string): string {
  const trimmedPrompt = originalGoalPrompt.trim();
  const userInstructionsMatch = USER_INSTRUCTIONS_HEADING_PATTERN.exec(trimmedPrompt);
  if (!userInstructionsMatch) return trimmedPrompt;

  const goalReferencesMatch = GOAL_REFERENCES_HEADING_PATTERN.exec(trimmedPrompt);
  if (goalReferencesMatch && goalReferencesMatch.index < userInstructionsMatch.index) {
    return trimmedPrompt.slice(goalReferencesMatch.index).trim();
  }

  const userInstructionsStart = userInstructionsMatch.index + userInstructionsMatch[0].length;
  const userInstructions = trimmedPrompt.slice(userInstructionsStart).trim();
  return userInstructions || trimmedPrompt;
}

function normalizeGoalPlannerOutput(plannerOutput: string): string {
  const trimmedOutput = plannerOutput.trim();
  const goalPlanBlock = trimmedOutput.match(GOAL_PLAN_BLOCK_PATTERN)?.[0]?.trim();
  if (goalPlanBlock) return goalPlanBlock;
  if (!trimmedOutput) return "GOAL_PLAN\nresearch=none\nEND_GOAL_PLAN";
  return (
    "GOAL_PLAN\n" +
    "research=none\n" +
    "unknowns=planner_output_missing_or_invalid\n" +
    "setup=use the original objective and mandatory references; block only if objective or proof is unclear\n" +
    "END_GOAL_PLAN"
  );
}

export function buildGoalSetupPromptFromPlanner({
  originalGoalPrompt,
  plannerOutput,
}: {
  originalGoalPrompt: string;
  plannerOutput: string;
}): string {
  const compactOriginalGoalPrompt = compactOriginalGoalPromptForSetup(originalGoalPrompt);
  const compactPlannerOutput = normalizeGoalPlannerOutput(plannerOutput);
  return (
    `## Original Goal Objective\n\n${compactOriginalGoalPrompt}\n\n` +
    `## Goal Planner Output\n\n${compactPlannerOutput}\n\n` +
    `Use the original objective plus this planner output to create durable Goal setup only. ` +
    `Record this exact GOAL_PLAN as durable setup evidence (for example with goals action=evidence, evidence_label="GOAL_PLAN"). ` +
    `Do not redo planner research unless the planner output is unusable.`
  );
}

export function isGoalPromptCommandName(cmdName: string): boolean {
  return getPromptCommand(cmdName)?.name === "goal";
}

export async function runGoalPromptSetupSequence({
  userContent,
  fullPrompt,
  messagesRef,
  setGoalModeAndPrompt,
  runAgent,
  onStage,
}: {
  userContent: UserContent;
  fullPrompt: string;
  messagesRef: { current: Message[] };
  setGoalModeAndPrompt: (nextMode: GoalMode) => Promise<void>;
  runAgent: (content: UserContent) => Promise<void>;
  onStage?: (text: string) => void;
}): Promise<void> {
  onStage?.("Planning Goal setup");
  await setGoalModeAndPrompt("planner");
  const plannerStartIndex = messagesRef.current.length;
  await runAgent(userContent);
  const plannerOutput = collectAssistantTextSince(messagesRef.current, plannerStartIndex);
  const setupPrompt = buildGoalSetupPromptFromPlanner({
    originalGoalPrompt: fullPrompt,
    plannerOutput,
  });
  await setGoalModeAndPrompt("setup");
  onStage?.("Creating Goal run");
  await runAgent(setupPrompt);
}

export function buildUserContentWithAttachments(
  text: string,
  inputImages: ImageAttachment[],
  modelSupportsImages: boolean,
): string | (TextContent | ImageContent)[] {
  if (inputImages.length === 0) return text;

  const parts: (TextContent | ImageContent)[] = [];
  if (text) {
    parts.push({ type: "text", text });
  }

  for (const img of inputImages) {
    if (img.kind === "text") {
      parts.push({
        type: "text",
        text: `<file name="${img.fileName}">\n${img.data}\n</file>`,
      });
    } else if (modelSupportsImages) {
      parts.push({ type: "image", mediaType: img.mediaType, data: img.data });
    } else {
      // GLM models: save image to temp file and instruct model to use vision MCP tool
      const ext = img.mediaType.split("/")[1] ?? "png";
      const tmpPath = `/tmp/ggcoder-img-${Date.now()}.${ext}`;
      try {
        writeFileSync(tmpPath, Buffer.from(img.data, "base64"));
        parts.push({
          type: "text",
          text: `[User attached an image saved at: ${tmpPath} — use the image_analysis tool to view and analyze it]`,
        });
      } catch {
        parts.push({
          type: "text",
          text: `[User attached an image but it could not be saved for analysis]`,
        });
      }
    }
  }

  // If only text parts remain after stripping images, simplify to plain string
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}
