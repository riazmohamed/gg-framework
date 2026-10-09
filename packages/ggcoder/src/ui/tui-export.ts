import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Message } from "@abukhaled/gg-ai";
import {
  defaultExportFilename,
  sessionToMarkdown,
  type ToolDetail,
} from "../core/session-export.js";
import type { SlashCommand } from "../core/slash-commands.js";

export interface ExportArgs {
  file?: string;
  toolDetail: ToolDetail;
  includeThinking: boolean;
  force: boolean;
}

/** `/export [file] [--tools none|summary|full] [--thinking] [--force]` */
export function parseExportArgs(args: string): ExportArgs | { error: string } {
  const parsed: ExportArgs = { toolDetail: "summary", includeThinking: false, force: false };
  const words = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "--thinking") parsed.includeThinking = true;
    else if (word === "--force") parsed.force = true;
    else if (word === "--tools") {
      const value = words[++i];
      if (value !== "none" && value !== "summary" && value !== "full") {
        return { error: "--tools takes none, summary or full." };
      }
      parsed.toolDetail = value;
    } else if (word.startsWith("--")) return { error: `Unknown option: ${word}` };
    else if (parsed.file) return { error: "Give one file name (quote-free; no spaces)." };
    else parsed.file = word;
  }
  return parsed;
}

export interface ExportSource {
  cwd: string;
  provider: string;
  model: string;
  sessionId?: string;
  messages: readonly Message[];
}

/** Write the transcript as Markdown; returns the message to show the user. */
export async function exportTranscript(source: ExportSource, args: string): Promise<string> {
  const parsed = parseExportArgs(args);
  if ("error" in parsed) return `${parsed.error}\nUsage: ${EXPORT_USAGE}`;
  if (!source.messages.some((m) => m.role === "user" || m.role === "assistant")) {
    return "Nothing to export yet.";
  }
  const date = new Date();
  const name = parsed.file ?? defaultExportFilename("code", date);
  let target = path.resolve(source.cwd, name.replace(/^~(?=[/\\]|$)/, os.homedir()));
  if (!path.extname(target)) target += ".md";
  if (!parsed.force) {
    const exists = await fs.stat(target).then(
      () => true,
      () => false,
    );
    if (exists) return `${target} already exists. Add --force to overwrite it.`;
  }
  const markdown = sessionToMarkdown(
    {
      mode: "code",
      cwd: source.cwd,
      provider: source.provider,
      model: source.model,
      date,
      ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    },
    source.messages,
    { toolDetail: parsed.toolDetail, includeThinking: parsed.includeThinking },
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, markdown, "utf8");
  return `Exported the conversation to ${target}`;
}

const EXPORT_USAGE = "/export [file] [--tools none|summary|full] [--thinking] [--force]";

/** The `/export` command, reading the live conversation through `source`. */
export function createExportCommand(source: () => ExportSource): SlashCommand {
  return {
    name: "export",
    aliases: [],
    description: "Save the conversation as Markdown",
    usage: EXPORT_USAGE,
    execute: (args) => exportTranscript(source(), args),
  };
}
