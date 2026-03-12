import { beforeEach, describe, expect, it, vi } from 'vitest'

const { persistExchangeMock, getSessionHistoryMock, createSessionMessageMock, getSessionMock } = vi.hoisted(() => ({
  persistExchangeMock: vi.fn(),
  getSessionHistoryMock: vi.fn(),
  createSessionMessageMock: vi.fn(),
  getSessionMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@main/services/agents/database', () => ({
  agentMessageRepository: {
    getSessionHistory: getSessionHistoryMock,
    persistExchange: persistExchangeMock
  }
}))

vi.mock('@main/services/agents', () => ({
  sessionMessageService: {
    createSessionMessage: createSessionMessageMock
  },
  sessionService: {
    getSession: getSessionMock
  }
}))

import { CommandExecutionService } from '../CommandExecutionService'
import type { RemoteCommandEnvelope } from '../types'

const buildStream = (chunks: Array<Record<string, unknown>>) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })

describe('CommandExecutionService', () => {
  const publishEnvelope = vi.fn()
  const publishSessionVersionBump = vi.fn()
  const adaptEvents = vi.fn()

  const snapshotProvider = {
    getSessionSnapshot: vi.fn()
  }

  const eventPublisher = {
    publishEnvelope,
    publishSessionVersionBump
  }

  const sseEventAdapter = {
    adaptEvents
  }

  const service = new CommandExecutionService(eventPublisher as any, sseEventAdapter as any, snapshotProvider as any)

  beforeEach(() => {
    vi.clearAllMocks()
    getSessionHistoryMock.mockResolvedValue([])
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'agent-1'
    })
    createSessionMessageMock.mockResolvedValue({
      stream: buildStream([
        {
          type: 'text-start',
          id: 'text-1'
        },
        {
          type: 'text-delta',
          id: 'text-1',
          text: 'hello'
        },
        {
          type: 'text-end',
          id: 'text-1'
        }
      ]),
      completion: Promise.resolve({})
    })
    snapshotProvider.getSessionSnapshot.mockResolvedValue({
      sessionId: 'session-1',
      snapshotVersion: 456,
      snapshotSeqCeiling: 0,
      version: 456,
      updatedAt: 456,
      messages: [],
      blocks: []
    })
    adaptEvents.mockImplementation((events, context) => {
      return events.map((event) => ({
        type: 'evt',
        event: event.event,
        requestId: context.requestId,
        runId: context.runId,
        ts: Date.now(),
        payload: event.payload
      }))
    })
  })

  it('suppresses streamed body events for desktop meta_only runs but still publishes version bumps', async () => {
    const envelope: RemoteCommandEnvelope = {
      type: 'cmd',
      event: 'message.send',
      requestId: 'request-1',
      runId: 'run-1',
      ts: Date.now(),
      payload: {
        sessionId: 'session-1',
        agentId: 'agent-1',
        content: 'hello',
        messageId: 'assistant:run-1',
        origin: 'desktop',
        runPushPolicy: 'meta_only'
      }
    }

    const result = await service.executeCommand(envelope)

    expect(result.accepted).toBe(true)
    expect(publishEnvelope).not.toHaveBeenCalled()
    expect(publishSessionVersionBump).toHaveBeenCalledWith({
      sessionId: 'session-1',
      version: 456,
      updatedAt: 456
    })
    expect(persistExchangeMock).toHaveBeenCalled()
  })

  it('publishes first-class semantic envelopes for ios full runs', async () => {
    const envelope: RemoteCommandEnvelope = {
      type: 'cmd',
      event: 'message.send',
      requestId: 'request-2',
      runId: 'run-2',
      ts: Date.now(),
      payload: {
        sessionId: 'session-1',
        agentId: 'agent-1',
        content: 'hello',
        messageId: 'assistant:run-2',
        origin: 'ios',
        runPushPolicy: 'full'
      }
    }

    const result = await service.executeCommand(envelope)

    expect(result.accepted).toBe(true)
    const publishedEvents = publishEnvelope.mock.calls.map((call) => call[0].event)
    expect(publishedEvents).toContain('message.started')
    expect(publishedEvents).toContain('message.block.added')
    expect(publishedEvents).toContain('message.block.updated')
    expect(publishedEvents).toContain('message.block.completed')
    expect(publishedEvents).toContain('message.completed')

    const completedEnvelope = publishEnvelope.mock.calls
      .map((call) => call[0])
      .find((item) => item.event === 'message.completed')
    expect(completedEnvelope?.payload.messageId).toBe('assistant:run-2')
    expect(publishSessionVersionBump).toHaveBeenCalledWith({
      sessionId: 'session-1',
      version: 456,
      updatedAt: 456
    })
  })

  it('persists assistant projection blocks without collapsing everything into one main_text block', async () => {
    createSessionMessageMock.mockResolvedValue({
      stream: buildStream([
        {
          type: 'reasoning-start',
          id: 'reasoning-1'
        },
        {
          type: 'reasoning-delta',
          id: 'reasoning-1',
          text: 'thinking'
        },
        {
          type: 'reasoning-end',
          id: 'reasoning-1'
        },
        {
          type: 'text-start',
          id: 'text-2'
        },
        {
          type: 'text-delta',
          id: 'text-2',
          text: 'answer'
        },
        {
          type: 'tool-call',
          toolCallId: 'tool-1',
          toolName: 'Read',
          input: {
            file: 'README.md'
          }
        },
        {
          type: 'tool-result',
          toolCallId: 'tool-1',
          output: {
            ok: true
          }
        },
        {
          type: 'finish-step',
          finishReason: 'stop'
        }
      ]),
      completion: Promise.resolve({})
    })

    const envelope: RemoteCommandEnvelope = {
      type: 'cmd',
      event: 'message.send',
      requestId: 'request-3',
      runId: 'run-3',
      ts: Date.now(),
      payload: {
        sessionId: 'session-1',
        agentId: 'agent-1',
        content: 'hello',
        messageId: 'assistant:run-3',
        origin: 'desktop',
        runPushPolicy: 'meta_only'
      }
    }

    await service.executeCommand(envelope)

    const assistantPayloads = persistExchangeMock.mock.calls.map((call) => call[0]?.assistant?.payload).filter(Boolean)

    expect(assistantPayloads.length).toBeGreaterThan(0)
    const latestAssistantPayload = assistantPayloads.at(-1)
    expect(latestAssistantPayload.message.content).toBe('answer')
    expect(latestAssistantPayload.blocks.map((block: { type: string }) => block.type)).toEqual([
      'thinking',
      'main_text',
      'tool'
    ])
  })

  it('updates persisted user and assistant messages when provider emits a new agent session id', async () => {
    createSessionMessageMock.mockResolvedValue({
      stream: buildStream([
        {
          type: 'raw',
          rawValue: {
            type: 'init',
            session_id: 'codex-thread-1'
          }
        },
        {
          type: 'text-start',
          id: 'text-3'
        },
        {
          type: 'text-delta',
          id: 'text-3',
          text: 'codex'
        },
        {
          type: 'text-end',
          id: 'text-3'
        }
      ]),
      completion: Promise.resolve({})
    })

    const envelope: RemoteCommandEnvelope = {
      type: 'cmd',
      event: 'message.send',
      requestId: 'request-4',
      runId: 'run-4',
      ts: Date.now(),
      payload: {
        sessionId: 'session-1',
        agentId: 'agent-1',
        content: 'hello',
        messageId: 'assistant:run-4',
        origin: 'ios',
        runPushPolicy: 'full'
      }
    }

    await service.executeCommand(envelope)

    const persistedAgentSessionIds = persistExchangeMock.mock.calls
      .map((call) => call[0]?.agentSessionId)
      .filter(Boolean)

    expect(persistedAgentSessionIds).toContain('codex-thread-1')

    const userPayloads = persistExchangeMock.mock.calls.map((call) => call[0]?.user?.payload).filter(Boolean)
    expect(userPayloads.at(-1)?.message?.agentSessionId).toBe('codex-thread-1')

    const assistantPayloads = persistExchangeMock.mock.calls.map((call) => call[0]?.assistant?.payload).filter(Boolean)
    expect(assistantPayloads.at(-1)?.message?.agentSessionId).toBe('codex-thread-1')
  })
})
