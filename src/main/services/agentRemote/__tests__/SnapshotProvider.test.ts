import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionHistoryMock } = vi.hoisted(() => ({
  getSessionHistoryMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@main/services/agents/database/sessionMessageRepository', () => ({
  agentMessageRepository: {
    getSessionHistory: getSessionHistoryMock
  }
}))

import { SnapshotProvider } from '../SnapshotProvider'

describe('SnapshotProvider', () => {
  const provider = new SnapshotProvider()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds snapshot v2 from persisted desktop authority structures', async () => {
    getSessionHistoryMock.mockResolvedValue([
      {
        message: {
          id: 'assistant-1',
          role: 'assistant',
          status: 'success',
          createdAt: '2026-03-12T00:00:00.000Z',
          updatedAt: '2026-03-12T00:00:05.000Z',
          traceId: 'run-1',
          agentSessionId: 'claude-session-1'
        },
        blocks: [
          {
            id: 'thinking-1',
            type: 'thinking',
            content: 'plan',
            createdAt: '2026-03-12T00:00:00.000Z',
            updatedAt: '2026-03-12T00:00:01.000Z',
            status: 'success'
          },
          {
            id: 'text-1',
            type: 'main_text',
            content: 'final answer',
            createdAt: '2026-03-12T00:00:02.000Z',
            updatedAt: '2026-03-12T00:00:05.000Z',
            status: 'success'
          }
        ]
      }
    ])

    const snapshot = await provider.getSessionSnapshot('session-1', 9)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.snapshotSeqCeiling).toBe(9)
    expect(snapshot?.snapshotVersion).toBe(2)
    expect(snapshot?.version).toBe(Date.parse('2026-03-12T00:00:05.000Z'))
    expect(snapshot?.updatedAt).toBe(Date.parse('2026-03-12T00:00:05.000Z'))
    expect(snapshot?.messages[0]?.messageId).toBe('assistant-1')
    expect(snapshot?.messages[0]?.blockIds).toEqual(['thinking-1', 'text-1'])
    expect(snapshot?.blocks.map((block) => block.type)).toEqual(['thinking', 'main_text'])
    expect(snapshot?.blocks[1]?.content).toBe('final answer')
  })
})
