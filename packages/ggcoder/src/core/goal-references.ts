import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GoalReference } from "./goal-store.js";
import type { ImageAttachment } from "../utils/image.js";

const GOAL_REFERENCES_DIR = ".gg/goal-references";
const MAX_PROMPT_REFERENCE_CHARS = 12_000;
const MAX_INLINE_REFERENCE_CHARS = 6_000;
const MAX_FORMATTED_REFERENCE_CHARS = 18_000;
const URL_PATTERN = /https?:\/\/[^\s<>()"']+/g;

export interface GoalReferenceContext {
  references: GoalReference[];
  promptSection: string;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.max(0, Math.floor((maxChars - 32) / 2));
  return `${text.slice(0, keep)}\n[reference truncated]\n${text.slice(text.length - keep)}`;
}

function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return base || "reference";
}

function extensionForAttachment(attachment: ImageAttachment): string {
  const fromName = path.extname(attachment.fileName);
  if (fromName) return fromName;
  if (attachment.kind === "text") return ".txt";
  if (attachment.mediaType === "image/jpeg") return ".jpg";
  if (attachment.mediaType === "image/webp") return ".webp";
  if (attachment.mediaType === "image/gif") return ".gif";
  return ".png";
}

function toProjectRelativePath(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function classifyUrl(url: string): GoalReference["kind"] {
  return /^https?:\/\/(?:www\.)?github\.com\/[^\s/]+\/[^\s/#?]+/i.test(url) ? "repo" : "url";
}

function normalizeUrlToken(url: string): string {
  return url.replace(/[),.;!?]+$/g, "");
}

function extractUrlReferences(text: string): GoalReference[] {
  const urls = Array.from(new Set((text.match(URL_PATTERN) ?? []).map(normalizeUrlToken)));
  return urls.map((url) => {
    const kind = classifyUrl(url);
    const id = `${kind}-${hashText(url)}`;
    return {
      id,
      kind,
      label: kind === "repo" ? `Reference repository ${url}` : `Reference URL ${url}`,
      value: url,
      description:
        kind === "repo"
          ? "Repository supplied in the original Goal prompt; workers/verifier must compare against it when relevant."
          : "URL supplied in the original Goal prompt; workers/verifier must use it when relevant.",
      source: "original-goal-prompt",
    };
  });
}

async function persistAttachmentReference(
  cwd: string,
  attachment: ImageAttachment,
): Promise<GoalReference> {
  const digest = hashText(`${attachment.fileName}\n${attachment.mediaType}\n${attachment.data}`);
  const id = `${attachment.kind}-${digest}`;
  const ext = extensionForAttachment(attachment);
  const fileName = `${id}-${safeFileName(attachment.fileName).replace(/\.[^.]*$/, "")}${ext}`;
  const absoluteDir = path.join(cwd, GOAL_REFERENCES_DIR);
  const absolutePath = path.join(absoluteDir, fileName);
  await mkdir(absoluteDir, { recursive: true });

  if (attachment.kind === "text") {
    await writeFile(absolutePath, attachment.data, "utf-8");
    return {
      id,
      kind: "text",
      label: `Attached text reference ${attachment.fileName}`,
      path: toProjectRelativePath(cwd, absolutePath),
      mediaType: attachment.mediaType,
      content: truncateMiddle(attachment.data, MAX_INLINE_REFERENCE_CHARS),
      source: attachment.filePath,
      description:
        "Text/document supplied with the original Goal prompt; setup, workers, verifier, and final audit must account for it.",
    };
  }

  await writeFile(absolutePath, Buffer.from(attachment.data, "base64"));
  return {
    id,
    kind: "image",
    label: `Attached image reference ${attachment.fileName}`,
    path: toProjectRelativePath(cwd, absolutePath),
    mediaType: attachment.mediaType,
    source: attachment.filePath,
    description:
      "Image/screenshot supplied with the original Goal prompt; workers/verifier must inspect or compare against it when relevant.",
  };
}

export async function buildGoalReferenceContext({
  cwd,
  originalGoalPrompt,
  attachments,
}: {
  cwd: string;
  originalGoalPrompt: string;
  attachments: readonly ImageAttachment[];
}): Promise<GoalReferenceContext> {
  const references: GoalReference[] = [];
  const trimmedPrompt = originalGoalPrompt.trim();
  if (trimmedPrompt) {
    references.push({
      id: "original-goal-prompt",
      kind: "prompt",
      label: "Original Goal prompt",
      content: truncateMiddle(trimmedPrompt, MAX_PROMPT_REFERENCE_CHARS),
      source: "user",
      description:
        "The exact /goal prompt text that started this run. Preserve its reference requirements in criteria, tasks, verifier, and audit.",
    });
    references.push(...extractUrlReferences(trimmedPrompt));
  }

  for (const attachment of attachments) {
    references.push(await persistAttachmentReference(cwd, attachment));
  }

  return {
    references,
    promptSection: formatGoalReferencesForPrompt(references),
  };
}

function formatReferenceValue(reference: GoalReference): string {
  const parts = [
    `- [${reference.id}] kind=${reference.kind}; label=${JSON.stringify(reference.label)}`,
  ];
  if (reference.value) parts.push(`  value: ${reference.value}`);
  if (reference.path) parts.push(`  path: ${reference.path}`);
  if (reference.mediaType) parts.push(`  media_type: ${reference.mediaType}`);
  if (reference.description) parts.push(`  why_it_matters: ${reference.description}`);
  if (reference.source) parts.push(`  source: ${reference.source}`);
  if (reference.content) {
    parts.push("  content_excerpt:");
    parts.push(
      truncateMiddle(reference.content, MAX_INLINE_REFERENCE_CHARS)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
  }
  return parts.join("\n");
}

export function formatGoalReferencesForPrompt(references: readonly GoalReference[]): string {
  if (references.length === 0) return "";
  const formatted = references.map(formatReferenceValue).join("\n");
  const body = truncateMiddle(formatted, MAX_FORMATTED_REFERENCE_CHARS);
  return (
    `## Goal References (MANDATORY)\n\n` +
    `These references came from the user's original /goal prompt, URLs/repos, screenshots, or attached documents. ` +
    `They are not optional context: success criteria, worker tasks, evidence paths, verifier, and final audit must use the relevant reference IDs. ` +
    `If a reference cannot be accessed or compared locally, block the Goal with exact user instructions instead of silently ignoring it.\n\n` +
    body
  );
}

export function referencesRequiringAcknowledgement(
  references: readonly GoalReference[],
): GoalReference[] {
  return references.filter((reference) => reference.kind !== "prompt");
}
