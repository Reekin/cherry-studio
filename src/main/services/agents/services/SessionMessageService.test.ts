import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadAgentProviderRuntimeMock, invokeMock } = vi.hoisted(() => ({
  loadAgentProviderRuntimeMock: vi.fn(),
  invokeMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      silly: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('../BaseService', () => ({
  BaseService: class {}
}))

vi.mock('../database/schema', () => ({
  sessionMessagesTable: {
    id: 'id',
    session_id: 'session_id',
    agent_session_id: 'agent_session_id',
    created_at: 'created_at'
  }
}))

vi.mock('../providers', () => ({
  loadAgentProviderRuntime: loadAgentProviderRuntimeMock
}))

import { SessionMessageService } from './SessionMessageService'

class TestAgentStream extends EventEmitter {
  declare emit: (event: 'data', data: unknown) => boolean
  declare on: (event: 'data', listener: (data: unknown) => void) => this
}

describe('SessionMessageService provider runtime selection', () => {
  const service = SessionMessageService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(service as any, 'getLastAgentSessionId').mockResolvedValue('agent-session-1')

    loadAgentProviderRuntimeMock.mockResolvedValue({
      invoke: invokeMock
    })
  })

  it('loads the runtime for the session agent type instead of hardcoding claude', async () => {
    let runtimeStream: TestAgentStream | undefined

    invokeMock.mockImplementation(async () => {
      runtimeStream = new TestAgentStream()
      return runtimeStream
    })

    const result = await service.createSessionMessage(
      {
        id: 'session-1',
        agent_id: 'agent-1',
        agent_type: 'codex',
        name: 'Codex Session',
        accessible_paths: ['I:/workspace'],
        instructions: 'Test',
        model: 'codex-placeholder',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any,
      {
        content: 'hello'
      },
      new AbortController()
    )

    runtimeStream?.emit('data', {
      type: 'complete'
    })

    await result.completion

    expect(loadAgentProviderRuntimeMock).toHaveBeenCalledWith('codex')
    expect(invokeMock).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ agent_type: 'codex' }),
      expect.any(AbortController),
      'agent-session-1',
      {
        effort: undefined,
        thinking: undefined
      }
    )
  })

  it('surfaces provider runtime failures explicitly', async () => {
    invokeMock.mockRejectedValue(new Error('Codex runtime unavailable'))

    await expect(
      service.createSessionMessage(
        {
          id: 'session-1',
          agent_id: 'agent-1',
          agent_type: 'codex',
          name: 'Codex Session',
          accessible_paths: ['I:/workspace'],
          instructions: 'Test',
          model: 'codex-placeholder',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as any,
        {
          content: 'hello'
        },
        new AbortController()
      )
    ).rejects.toThrow('Codex runtime unavailable')
  })
})
