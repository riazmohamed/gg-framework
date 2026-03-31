import type { Provider } from "@abukhaled/gg-ai";
import type { MCPServerConfig } from "./types.js";

export const DEFAULT_MCP_SERVERS: MCPServerConfig[] = [
  { name: "grep", url: "https://mcp.grep.app" },
];

/**
 * Get MCP servers for a specific provider.
 * GLM models get Z.AI MCP servers for web search, web reading, and GitHub exploration.
 */
export function getMCPServers(provider: Provider, apiKey?: string): MCPServerConfig[] {
  const servers = [...DEFAULT_MCP_SERVERS];

  if (provider === "glm" && apiKey) {
    const zaiAuth = { Authorization: `Bearer ${apiKey}` };

    // Web search
    servers.push({
      name: "zai_web_search",
      url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
      headers: zaiAuth,
      timeout: 60_000,
    });

    // Web reader (full-page content extraction)
    servers.push({
      name: "zai_web_reader",
      url: "https://api.z.ai/api/mcp/web_reader/mcp",
      headers: zaiAuth,
      timeout: 60_000,
    });

    // GitHub repository exploration
    servers.push({
      name: "zai_zread",
      url: "https://api.z.ai/api/mcp/zread/mcp",
      headers: zaiAuth,
      timeout: 60_000,
    });
  }

  return servers;
}
