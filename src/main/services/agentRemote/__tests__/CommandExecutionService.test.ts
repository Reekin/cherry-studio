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

const buildStream = (chunks: string[]) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue({
          type: 'text-delta',
          text: chunk
        })
      }
      controller.close()
    }
  })

describe('CommandExecutionService', () => {
  const publishEnvelope = vi.fn()
  const publishSessionVersionBump = vi.fn()
  const adaptStream = vi.fn()

  const snapshotProvider = {
    getSessionSnapshot: vi.fn()
  }

  const eventPublisher = {
    publishEnvelope,
    publishSessionVersionBump
  }

  const sseEventAdapter = {
    adaptStream
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
      stream: buildStream(['hello']),
      completion: Promise.resolve({})
    })
    snapshotProvider.getSessionSnapshot.mockResolvedValue({
      sessionId: 'session-1',
      snapshotVersion: 2,
      snapshotSeqCeiling: 0,
      updatedAt: 123,
      messages: []
    })
    adaptStream.mockImplementation(async function* (_stream, context) {
      yield {
        type: 'evt',
        event: 'message.delta',
        requestId: context.requestId,
        runId: context.runId,
        ts: 1,
        payload: {
          sessionId: context.sessionId,
          runId: context.runId,
          messageId: context.messageId,
          role: 'assistant',
          delta: 'hello',
          updatedAt: 111
        }
      }
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
      version: 2,
      updatedAt: 123
    })
    expect(persistExchangeMock).toHaveBeenCalledTimes(4)
  })

  it('publishes delta and done envelopes for ios full runs', async () => {
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
    expect(publishEnvelope).toHaveBeenCalledTimes(2)

    const [deltaEnvelope, doneEnvelope] = publishEnvelope.mock.calls.map((call) => call[0])
    expect(deltaEnvelope.event).toBe('message.delta')
    expect(doneEnvelope.event).toBe('message.done')
    expect(doneEnvelope.payload.messageId).toBe('assistant:run-2')
    expect(publishSessionVersionBump).toHaveBeenCalledWith({
      sessionId: 'session-1',
      version: 2,
      updatedAt: 123
    })
  })
})
