import { invoke } from "@tauri-apps/api/core";

/**
 * Map a natively picked path (folder dialog) to the path the agent should use.
 * Identity normally; in the fork's WSL mode the shell turns
 * `\\wsl.localhost\<distro>\…` into the Linux path the WSL-hosted sidecar sees.
 */
export async function toAgentPath(path: string): Promise<string> {
  return invoke<string>("app_agent_path", { path });
}

/** `toAgentPath` over several picked paths, preserving order. */
export async function toAgentPaths(paths: string[]): Promise<string[]> {
  return Promise.all(paths.map(toAgentPath));
}
