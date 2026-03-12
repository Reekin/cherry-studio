import type { Tool } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

import { validateModelId } from '@main/apiServer/utils'

import { BaseService } from '../BaseService'

class TestBaseService extends BaseService {
  public normalize(
    allowedTools: string[] | undefined,
    tools: Tool[],
    legacyIdMap?: Map<string, string>
  ): string[] | undefined {
    return this.normalizeAllowedTools(allowedTools, tools, legacyIdMap)
  }

  public async validateModelsForTest(agentType: 'claude-code' | 'codex', model: string): Promise<void> {
    await this.validateAgentModels(agentType, {
      model
    })
  }
}

const buildMcpTool = (id: string): Tool => ({
  id,
  name: id,
  type: 'mcp',
  description: 'test tool',
  requirePermissions: true
})

describe('BaseService.normalizeAllowedTools', () => {
  const service = new TestBaseService()

  it('returns undefined or empty inputs unchanged', () => {
    expect(service.normalize(undefined, [])).toBeUndefined()
    expect(service.normalize([], [])).toEqual([])
  })

  it('normalizes legacy MCP tool IDs and deduplicates entries', () => {
    const tools: Tool[] = [
      buildMcpTool('mcp__server_one__tool_one'),
      buildMcpTool('mcp__server_two__tool_two'),
      { id: 'custom_tool', name: 'custom_tool', type: 'custom' }
    ]

    const legacyIdMap = new Map<string, string>([
      ['mcp__server-1__tool-one', 'mcp__server_one__tool_one'],
      ['mcp_server-1_tool-one', 'mcp__server_one__tool_one'],
      ['mcp__server-2__tool-two', 'mcp__server_two__tool_two']
    ])

    const allowedTools = [
      'mcp__server-1__tool-one',
      'mcp_server-1_tool-one',
      'mcp_server_one_tool_one',
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two',
      'mcp_server_two_tool_two',
      'mcp__server-2__tool-two'
    ]

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__server_one__tool_one',
      'custom_tool',
      'mcp__server_two__tool_two'
    ])
  })

  it('keeps legacy IDs when no matching MCP tool exists', () => {
    const tools: Tool[] = [buildMcpTool('mcp__server_one__tool_one')]
    const legacyIdMap = new Map<string, string>([['mcp__server-1__tool-one', 'mcp__server_one__tool_one']])

    const allowedTools = ['mcp__unknown__tool', 'mcp__server_one__tool_one']

    expect(service.normalize(allowedTools, tools, legacyIdMap)).toEqual([
      'mcp__unknown__tool',
      'mcp__server_one__tool_one'
    ])
  })

  it('returns allowed tools unchanged when no MCP tools are available', () => {
    const allowedTools = ['custom_tool', 'builtin_tool']
    const tools: Tool[] = [{ id: 'custom_tool', name: 'custom_tool', type: 'custom' }]

    expect(service.normalize(allowedTools, tools)).toEqual(allowedTools)
  })
})

describe('BaseService provider metadata', () => {
  const service = new TestBaseService()

  it('skips hosted model validation for codex providers', async () => {
    await service.validateModelsForTest('codex', 'codex-placeholder')

    expect(validateModelId).not.toHaveBeenCalled()
  })

  it('validates hosted models for claude providers', async () => {
    vi.mocked(validateModelId).mockResolvedValue({
      valid: true,
      provider: {
        id: 'anthropic',
        apiKey: 'test-key'
      },
      modelId: 'claude-3-7-sonnet'
    } as Awaited<ReturnType<typeof validateModelId>>)

    await service.validateModelsForTest('claude-code', 'anthropic:claude-3-7-sonnet')

    expect(validateModelId).toHaveBeenCalledWith('anthropic:claude-3-7-sonnet')
  })

  it('lists provider-specific builtin slash commands', async () => {
    const claudeCommands = await service.listSlashCommands('claude-code')
    const codexCommands = await service.listSlashCommands('codex')

    expect(claudeCommands.length).toBeGreaterThan(0)
    expect(codexCommands).toEqual([])
  })
})
