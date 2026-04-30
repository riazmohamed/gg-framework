/**
 * API-key store. Separate from auth.json (which holds OAuth tokens
 * with refresh metadata) so we don't pollute that schema with bare
 * static keys. Lives at ~/.gg/api-keys.json:
 *
 *   {
 *     "openai": "sk-...",
 *     "huggingface": "hf_..."
 *   }
 *
 * Used by vision tools (analyze_hook / score_shot / color_match /
 * skin_grade / match_clip_color) when the matching env var isn't set
 * — onboarding can capture the key once and persist it here.
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const API_KEYS_PATH = join(homedir(), ".gg", "api-keys.json");

export type ApiKeyName = "openai" | "huggingface";

interface KeyStore {
  openai?: string;
  huggingface?: string;
}

let _cache: KeyStore | undefined;

function loadStore(): KeyStore {
  if (_cache) return _cache;
  try {
    const raw = readFileSync(API_KEYS_PATH, "utf8");
    _cache = JSON.parse(raw) as KeyStore;
  } catch {
    _cache = {};
  }
  return _cache;
}

function saveStore(store: KeyStore): void {
  mkdirSync(dirname(API_KEYS_PATH), { recursive: true });
  writeFileSync(API_KEYS_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
  // 0600 so other users on the system can't read the key.
  try {
    chmodSync(API_KEYS_PATH, 0o600);
  } catch {
    // Best-effort — some filesystems (network mounts, CI sandboxes)
    // ignore chmod. Not a hard error.
  }
  _cache = store;
}

/**
 * Read a stored API key. Returns undefined when none is saved.
 * The key store is cached after first load.
 */
export function getStoredApiKey(name: ApiKeyName): string | undefined {
  const v = loadStore()[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Persist an API key. Trims whitespace; throws if empty.
 */
export function setStoredApiKey(name: ApiKeyName, key: string): void {
  const trimmed = key.trim();
  if (trimmed.length === 0) throw new Error(`API key for ${name} is empty`);
  const store = { ...loadStore(), [name]: trimmed };
  saveStore(store);
}

/**
 * Convenience: env var first, then the stored value. The order matches
 * how the vision modules already work — they default to the env var,
 * and now they get a sensible fallback when it's not set.
 */
export function resolveApiKey(envVar: string, name: ApiKeyName): string | undefined {
  return process.env[envVar] || getStoredApiKey(name);
}

export const API_KEYS_FILE = API_KEYS_PATH;
