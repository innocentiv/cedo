import { describe, expect, test } from 'bun:test'
import { McpClientConfig, aiClientConfigs, mcpAddress } from './connect.ts'

/** What "Connect your AI" hands a self-hoster to paste: this instance's MCP address, and a token. */
describe('connecting an AI', () => {
  test('the MCP address is the API root’s, wherever it is served', () => {
    expect(mcpAddress('https://gym.example/api')).toBe('https://gym.example/api/mcp')
    expect(mcpAddress('https://gym.example/api/')).toBe('https://gym.example/api/mcp')
    expect(mcpAddress('http://192.168.1.20:8080/api')).toBe('http://192.168.1.20:8080/api/mcp')
  })

  /** For the user, not the folder it was typed in: `local`, the default, is that one project only. */
  test('Claude Code adds it in one line, for the user, the token in its header', () => {
    expect(aiClientConfigs('https://gym.example/api/mcp', 'cedo_abc').claudeCode).toBe(
      'claude mcp add --transport http --scope user cedo https://gym.example/api/mcp --header "Authorization: Bearer cedo_abc"',
    )
  })

  test('any other client reads the same in JSON', () => {
    const { json } = aiClientConfigs('https://gym.example/api/mcp', 'cedo_abc')
    expect(McpClientConfig.parse(JSON.parse(json))).toEqual({
      mcpServers: {
        cedo: {
          type: 'http',
          url: 'https://gym.example/api/mcp',
          headers: { Authorization: 'Bearer cedo_abc' },
        },
      },
    })
  })
})
