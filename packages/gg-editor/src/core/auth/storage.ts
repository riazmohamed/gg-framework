import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshAnthropicToken } from "./anthropic.js";
import { refreshOpenAIToken } from "./openai.js";
import {
  STATIC_KEY_PROVIDERS,
  type OAuthCredentials,
  type SupportedAuthProvider,
} from "./types.js";

/**
 * Auth storage backed by ~/.gg/auth.json — the SAME file ggcoder uses, so
 * credentials carry across both CLIs. Logging into one logs into the other.
 *
 * Simplified vs ggcoder's version: no multi-process file-lock (single-CLI
 * use case here) and no logger; otherwise the wire format is identical.
 */

type AuthData = Record<string, OAuthCredentials>;

export const AUTH_FILE = path.join(os.homedir(), ".gg", "auth.json");

export class AuthStorage {
  private data: AuthData = {};
  private loaded = false;
  private filePath: string;
  private refreshLocks = new Map<string, Promise<OAuthCredentials>>();

  constructor(filePath: string = AUTH_FILE) {
    this.filePath = filePath;
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      this.data = JSON.parse(content) as AuthData;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw new Error(`failed to read ${this.filePath}: ${(err as Error).message}`, {
          cause: err,
        });
      }
      this.data = {};
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  async hasCredentials(provider: string): Promise<boolean> {
    await this.ensureLoaded();
    return Boolean(this.data[provider]);
  }

  async getCredentials(provider: string): Promise<OAuthCredentials | undefined> {
    await this.ensureLoaded();
    return this.data[provider];
  }

  async setCredentials(provider: string, creds: OAuthCredentials): Promise<void> {
    await this.ensureLoaded();
    this.data[provider] = creds;
    await this.save();
  }

  async clearCredentials(provider: string): Promise<void> {
    await this.ensureLoaded();
    delete this.data[provider];
    await this.save();
  }

  async listProviders(): Promise<string[]> {
    await this.ensureLoaded();
    return Object.keys(this.data);
  }

  /**
   * Returns valid credentials, auto-refreshing if expired. When
   * `forceRefresh` is true, refreshes even if the stored token hasn't
   * expired — used to recover from 401s when the provider revoked the
   * token before the local expiry. Throws if no credentials are stored.
   */
  async resolveCredentials(
    provider: SupportedAuthProvider,
    opts?: { forceRefresh?: boolean },
  ): Promise<OAuthCredentials> {
    await this.ensureLoaded();
    const creds = this.data[provider];
    if (!creds) throw new NotLoggedInError(provider);

    // Static-key providers (GLM / Moonshot / Xiaomi / MiniMax / DeepSeek /
    // OpenRouter) don't have a refresh path — they're stored API keys.
    if (STATIC_KEY_PROVIDERS.has(provider)) return creds;

    if (!opts?.forceRefresh && Date.now() < creds.expiresAt) return creds;

    // Coalesce concurrent refresh calls.
    const existing = this.refreshLocks.get(provider);
    if (existing) return existing;

    const refreshPromise = (async () => {
      const refreshFn = provider === "anthropic" ? refreshAnthropicToken : refreshOpenAIToken;
      const refreshed = await refreshFn(creds.refreshToken);
      if (!refreshed.accountId && creds.accountId) refreshed.accountId = creds.accountId;
      this.data[provider] = refreshed;
      await this.save();
      return refreshed;
    })();

    this.refreshLocks.set(provider, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.refreshLocks.delete(provider);
    }
  }

  async resolveToken(provider: SupportedAuthProvider): Promise<string> {
    return (await this.resolveCredentials(provider)).accessToken;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${crypto
      .randomUUID()
      .slice(0, 8)}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      await fs.rename(tmp, this.filePath);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

export class NotLoggedInError extends Error {
  provider: string;
  constructor(provider: string) {
    super(`Not logged in to ${provider}. Run "ggeditor login" to authenticate.`);
    this.name = "NotLoggedInError";
    this.provider = provider;
  }
}
