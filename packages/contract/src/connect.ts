import { z } from 'zod'

/**
 * Connecting an AI: the instance brings no model of its own (no API key on the server, nothing sent
 * to a provider), so the user brings theirs, through MCP — the single AI surface. What it needs is
 * this instance's MCP address and a personal access token; these say both in the forms a client
 * reads. The API mounts its MCP server at `MCP_PATH`, so the address cannot drift from the route.
 * See docs/07-mcp.md.
 */

/** Where the MCP server answers, under the API's root. */
export const MCP_PATH = '/mcp'

/** The name a client registers this instance's server under. */
export const MCP_SERVER_NAME = 'cedo'

/** The MCP address under an absolute API root: `https://gym.example/api` → `…/api/mcp`. */
export function mcpAddress(apiRoot: string): string {
  return `${apiRoot.replace(/\/$/u, '')}${MCP_PATH}`
}

/**
 * The `mcpServers` configuration Claude Code's `.mcp.json` and Cursor read: each server by name,
 * reached over HTTP with its headers. What the JSON snippet is, and what a test reads it back as.
 */
export const McpClientConfig = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      type: z.literal('http'),
      url: z.string(),
      headers: z.record(z.string(), z.string()),
    }),
  ),
})
export type McpClientConfig = z.output<typeof McpClientConfig>

export interface AiClientConfigs {
  /** A `claude mcp add` command, on one line so it pastes into any shell. */
  readonly claudeCode: string
  /** An `McpClientConfig`, as JSON to paste. */
  readonly json: string
}

export function aiClientConfigs(address: string, token: string): AiClientConfigs {
  const authorization = `Bearer ${token}`
  const config: McpClientConfig = {
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'http', url: address, headers: { Authorization: authorization } },
    },
  }
  return {
    // `--scope user`: every project, as a self-hoster expects, not only the folder it was typed in.
    // The header last, because `--header` takes every argument after it.
    claudeCode: `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${address} --header "Authorization: ${authorization}"`,
    json: JSON.stringify(config, null, 2),
  }
}
