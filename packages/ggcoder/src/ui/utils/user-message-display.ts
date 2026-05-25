import type { PasteInfo } from "../components/InputArea.js";

export interface UserMessageDisplayPart {
  text: string;
  kind: "text" | "paste";
}

export function getUserMessageDisplayParts(
  text: string,
  pasteInfo?: PasteInfo,
): UserMessageDisplayPart[] {
  const hasPaste = pasteInfo != null && pasteInfo.length > 0;
  if (!hasPaste) {
    return [{ text: collapseSubmittedUserText(text) || "(empty)", kind: "text" }];
  }

  const typedBefore = collapseSubmittedUserText(text.slice(0, pasteInfo.offset));
  const typedAfter = collapseSubmittedUserText(text.slice(pasteInfo.offset + pasteInfo.length));
  const parts: UserMessageDisplayPart[] = [];
  if (typedBefore.length > 0) parts.push({ text: typedBefore, kind: "text" });
  parts.push({
    text: `[Pasted text #${pasteInfo.length} +${pasteInfo.lineCount} lines]`,
    kind: "paste",
  });
  if (typedAfter.length > 0) parts.push({ text: typedAfter, kind: "text" });
  return parts;
}

function collapseSubmittedUserText(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ⏎ ");
}
