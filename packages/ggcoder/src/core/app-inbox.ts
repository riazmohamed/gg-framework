import fs from "node:fs";
import path from "node:path";

/**
 * The app inbox: messages other local tools leave for an open GG Coder window,
 * so work goes to the session already running in that project instead of a new
 * one. A tool writes one JSON file per message into `~/.gg/inbox/`
 * (`{ cwd, title, text, from? }`). The window whose cwd matches shows it above
 * the composer, and nothing is sent until the user clicks Send. Sending or
 * dismissing deletes the file.
 */

export interface InboxItem {
  /** The file name without `.json`. */
  id: string;
  /** Who left it ("Autopilot"), shown as the strip's lead. */
  from: string;
  title: string;
  /** Sent as the user's message, word for word, when they click Send. */
  text: string;
  createdAt: number;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_FILE_BYTES = 16_384;
const MAX_TITLE = 200;
const MAX_TEXT = 4_000;
const MAX_FROM = 40;
const MAX_ITEMS = 20;

export function inboxDir(agentDir: string): string {
  return path.join(agentDir, "inbox");
}

export function isInboxId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function parseItem(id: string, raw: string, mtimeMs: number, cwd: string): InboxItem | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { cwd: target, title, text, from } = body as Record<string, unknown>;
  if (typeof target !== "string" || !path.isAbsolute(target)) return null;
  if (realOrResolved(target) !== realOrResolved(cwd)) return null;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return null;
  const heading = typeof title === "string" && title.trim() ? title.trim() : text.trim();
  return {
    id,
    from: typeof from === "string" && from.trim() ? from.trim().slice(0, MAX_FROM) : "Inbox",
    title: heading.slice(0, MAX_TITLE),
    text,
    createdAt: Math.round(mtimeMs),
  };
}

/** The messages left for `cwd`, oldest first. A missing folder is an empty inbox. */
export function listInbox(dir: string, cwd: string): InboxItem[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const items: InboxItem[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isInboxId(id)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const item = parseItem(id, fs.readFileSync(file, "utf8"), stat.mtimeMs, cwd);
      if (item) items.push(item);
    } catch {
      continue;
    }
  }
  items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return items.slice(0, MAX_ITEMS);
}

/** Delete one message, only if it was left for `cwd`. True when it was removed. */
export function removeInboxItem(dir: string, cwd: string, id: string): boolean {
  if (!isInboxId(id)) return false;
  if (!listInbox(dir, cwd).some((item) => item.id === id)) return false;
  try {
    fs.unlinkSync(path.join(dir, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
