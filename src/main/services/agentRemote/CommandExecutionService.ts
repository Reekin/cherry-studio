import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { sessionMessageService, sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database'
import type { AgentPersistedMessage, GetAgentSessionResponse } from '@types'

import { EventPublisher } from './EventPublisher'
import { SnapshotProvider } from './SnapshotProvider'
import { SseEventAdapter } from './SseEventAdapter'
import {
  createRemoteErrorEnvelope,
  createRemoteEventEnvelope,
  type RemoteCommandEnvelope,
  type RemoteErrorEnvelope,
  type RemoteEventEnvelope
} from './types'

const logger = loggerService.withContext('CommandExecutionService')

export interface CommandExecutionResult {
  accepted: boolean
  reason?: string
  responseEnvelope?: RemoteErrorEnvelope | RemoteEventEnvelope
}

type PersistedRemoteMessage = AgentPersistedMessage['message']
type PersistedRemoteBlock = AgentPersistedMessage['blocks'][number]
type PersistedExchangeSnapshot = {
  userMessageId: string
  assistantMessageId: string
  assistantBlockId: string
  assistantContent: string
  agentSessionId: string
}

export class CommandExecutionService {
  constructor(
    private readonly eventPublisher: EventPublisher,
    private readonly sseEventAdapter: SseEventAdapter,
    private readonly snapshotProvider: SnapshotProvider
  ) {}

  async executeCommand(envelope: RemoteCommandEnvelope): Promise<CommandExecutionResult> {
    switch (envelope.event) {
      case 'session.create':
        return this.handleCreateSession(envelope)
      case 'message.send':
        return this.handleSendMessage(envelope)
      case 'session.snapshot':
        return this.handleSnapshot(envelope)
      default:
        logger.info('Ignoring unsupported remote command', {
          event: envelope.event,
          requestId: envelope.requestId
        })
        return {
          accepted: false,
          reason: 'unsupported_command',
          responseEnvelope: createRemoteErrorEnvelope('VALIDATION_FAILED', `Unsupported command: ${envelope.event}`, {
            requestId: envelope.requestId,
            runId: envelope.runId,
            sessionId:
              envelope.payload &&
              typeof envelope.payload === 'object' &&
              'sessionId' in envelope.payload &&
              typeof envelope.payload.sessionId === 'string'
                ? envelope.payload.sessionId
                : undefined
          })
        }
    }
  }

  private async handleCreateSession(envelope: Extract<RemoteCommandEnvelope, { event: 'session.create' }>) {
    try {
      const session = await sessionService.createSession(envelope.payload.agentId, {
        name: envelope.payload.title
      })

      if (!session) {
        return {
          accepted: false,
          reason: 'session_create_failed',
          responseEnvelope: createRemoteErrorEnvelope('BRIDGE_OFFLINE', 'Failed to create remote session', {
            requestId: envelope.requestId,
            runId: envelope.runId,
            retryable: true
          })
        }
      }

      const responseEnvelope = createRemoteEventEnvelope(
        'session.created',
        {
          sessionId: session.id,
          agentId: session.agent_id,
          title: session.name ?? envelope.payload.title,
          version: 0,
          updatedAt: Date.now(),
          origin: 'ios',
          runPushPolicy: 'full'
        },
        {
          requestId: envelope.requestId,
          runId: envelope.runId
        }
      )

      this.eventPublisher.publishEnvelope(responseEnvelope)

      return {
        accepted: true,
        responseEnvelope
      }
    } catch (error) {
      logger.error('Failed to create remote session', {
        error: error instanceof Error ? error.message : String(error),
        requestId: envelope.requestId
      })

      return {
        accepted: false,
        reason: 'session_create_failed',
        responseEnvelope: createRemoteErrorEnvelope(
          'VALIDATION_FAILED',
          error instanceof Error ? error.message : 'Failed to create remote session',
          {
            requestId: envelope.requestId,
            runId: envelope.runId,
            retryable: false
          }
        )
      }
    }
  }

  private async handleSendMessage(envelope: Extract<RemoteCommandEnvelope, { event: 'message.send' }>) {
    const runId = envelope.runId ?? randomUUID()
    const assistantMessageId = envelope.payload.messageId ?? `assistant:${runId}`
    const shouldPublishStream = envelope.payload.origin !== 'desktop' || envelope.payload.runPushPolicy !== 'meta_only'

    try {
      const session = await sessionService.getSession(envelope.payload.agentId, envelope.payload.sessionId)

      if (!session) {
        return {
          accepted: false,
          reason: 'session_not_found',
          responseEnvelope: createRemoteErrorEnvelope('VALIDATION_FAILED', 'Remote session not found', {
            requestId: envelope.requestId,
            runId,
            sessionId: envelope.payload.sessionId
          })
        }
      }

      const persisted = await this.createPersistedExchangeSnapshot(session, envelope, runId, assistantMessageId)
      await this.persistUserMessage(session, envelope.payload.content, persisted)

      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        {
          content: envelope.payload.content
        },
        new AbortController()
      )

      await this.persistAssistantMessage(session, persisted, {
        status: 'processing'
      })

      for await (const remoteEvent of this.sseEventAdapter.adaptStream(stream, {
        sessionId: envelope.payload.sessionId,
        requestId: envelope.requestId,
        runId,
        messageId: assistantMessageId
      })) {
        if (remoteEvent.type === 'evt' && remoteEvent.event === 'message.delta') {
          persisted.assistantContent += remoteEvent.payload.delta
          await this.persistAssistantMessage(session, persisted, {
            status: 'processing',
            updatedAt: remoteEvent.payload.updatedAt
          })
        }

        if (shouldPublishStream) {
          this.eventPublisher.publishEnvelope(remoteEvent)
        }
      }

      await completion

      const snapshot = await this.finalizeAssistantPersistence(session, persisted, {
        status: 'success'
      })
      const updatedAt = snapshot?.updatedAt ?? Date.now()
      const version = snapshot?.snapshotVersion ?? 0

      if (shouldPublishStream) {
        this.eventPublisher.publishEnvelope(
          createRemoteEventEnvelope(
            'message.done',
            {
              sessionId: envelope.payload.sessionId,
              runId,
              messageId: assistantMessageId,
              version,
              updatedAt,
              status: 'success'
            },
            {
              requestId: envelope.requestId,
              runId
            }
          )
        )
      }

      this.eventPublisher.publishSessionVersionBump({
        sessionId: envelope.payload.sessionId,
        version,
        updatedAt
      })

      return {
        accepted: true
      }
    } catch (error) {
      logger.error('Failed to stream remote session message', {
        error: error instanceof Error ? error.message : String(error),
        requestId: envelope.requestId,
        runId,
        sessionId: envelope.payload.sessionId
      })

      const responseEnvelope = createRemoteErrorEnvelope(
        'BRIDGE_OFFLINE',
        error instanceof Error ? error.message : 'Failed to execute remote message send',
        {
          requestId: envelope.requestId,
          runId,
          sessionId: envelope.payload.sessionId,
          retryable: true
        }
      )

      try {
        const session = await sessionService.getSession(envelope.payload.agentId, envelope.payload.sessionId)
        if (session) {
          const persisted = await this.createPersistedExchangeSnapshot(session, envelope, runId, assistantMessageId)
          await this.persistUserMessage(session, envelope.payload.content, persisted)
          await this.finalizeAssistantPersistence(session, persisted, {
            status: 'error',
            errorMessage: responseEnvelope.payload.message
          })
        }
      } catch (persistError) {
        logger.warn('Failed to persist remote error state', {
          error: persistError instanceof Error ? persistError.message : String(persistError),
          runId,
          sessionId: envelope.payload.sessionId
        })
      }

      if (shouldPublishStream) {
        this.eventPublisher.publishEnvelope(
          createRemoteEventEnvelope(
            'message.error',
            {
              sessionId: envelope.payload.sessionId,
              runId,
              messageId: assistantMessageId,
              code: responseEnvelope.payload.code,
              message: responseEnvelope.payload.message,
              retryable: true,
              updatedAt: Date.now()
            },
            {
              requestId: envelope.requestId,
              runId
            }
          )
        )
      }

      return {
        accepted: false,
        reason: 'message_send_failed',
        responseEnvelope
      }
    }
  }

  private async handleSnapshot(envelope: Extract<RemoteCommandEnvelope, { event: 'session.snapshot' }>) {
    const snapshot = await this.snapshotProvider.getSessionSnapshot(envelope.payload.sessionId, envelope.seq ?? 0)

    if (!snapshot) {
      return {
        accepted: false,
        reason: 'snapshot_unavailable',
        responseEnvelope: createRemoteErrorEnvelope('SNAPSHOT_REQUIRED', 'Remote snapshot is unavailable', {
          requestId: envelope.requestId,
          runId: envelope.runId,
          sessionId: envelope.payload.sessionId,
          retryable: true
        })
      }
    }

    const responseEnvelope = createRemoteEventEnvelope('session.snapshot', snapshot, {
      requestId: envelope.requestId,
      runId: envelope.runId
    })

    this.eventPublisher.publishEnvelope(responseEnvelope)

    return {
      accepted: true,
      responseEnvelope
    }
  }

  private async createPersistedExchangeSnapshot(
    session: GetAgentSessionResponse,
    envelope: Extract<RemoteCommandEnvelope, { event: 'message.send' }>,
    runId: string,
    assistantMessageId: string
  ): Promise<PersistedExchangeSnapshot> {
    const history = await agentMessageRepository.getSessionHistory(session.id)
    const lastAgentSessionId =
      history
        .map((item) => item.message?.agentSessionId)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .at(-1) ?? ''

    return {
      userMessageId: `user:${envelope.requestId ?? runId}`,
      assistantMessageId,
      assistantBlockId: `${assistantMessageId}:main`,
      assistantContent: '',
      agentSessionId: lastAgentSessionId
    }
  }

  private async persistUserMessage(
    session: GetAgentSessionResponse,
    content: string,
    persisted: PersistedExchangeSnapshot
  ): Promise<void> {
    const createdAt = new Date().toISOString()
    const message = this.createMessageRecord(session, {
      id: persisted.userMessageId,
      role: 'user',
      status: 'success',
      content,
      createdAt,
      updatedAt: createdAt,
      agentSessionId: persisted.agentSessionId
    })

    const block = this.createMainTextBlock(message.id, content, {
      createdAt,
      updatedAt: createdAt,
      status: 'success'
    })

    await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId: persisted.agentSessionId,
      user: {
        payload: {
          message,
          blocks: [block]
        }
      }
    })
  }

  private async persistAssistantMessage(
    session: GetAgentSessionResponse,
    persisted: PersistedExchangeSnapshot,
    options: {
      status: 'processing' | 'success' | 'error'
      updatedAt?: number
      errorMessage?: string
    }
  ): Promise<void> {
    const updatedAtIso = new Date(options.updatedAt ?? Date.now()).toISOString()
    const createdAtIso = updatedAtIso
    const message = this.createMessageRecord(session, {
      id: persisted.assistantMessageId,
      role: 'assistant',
      status: options.status === 'processing' ? 'processing' : options.status === 'error' ? 'error' : 'success',
      content: persisted.assistantContent,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      agentSessionId: persisted.agentSessionId
    })

    const block = this.createMainTextBlock(message.id, persisted.assistantContent, {
      id: persisted.assistantBlockId,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      status: options.status === 'processing' ? 'streaming' : options.status === 'error' ? 'error' : 'success',
      error: options.errorMessage
        ? ({
            message: options.errorMessage
          } as PersistedRemoteBlock['error'])
        : undefined
    })

    await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId: persisted.agentSessionId,
      assistant: {
        payload: {
          message,
          blocks: [block]
        }
      }
    })
  }

  private async finalizeAssistantPersistence(
    session: GetAgentSessionResponse,
    persisted: PersistedExchangeSnapshot,
    options: {
      status: 'success' | 'error'
      errorMessage?: string
    }
  ) {
    await this.persistAssistantMessage(session, persisted, {
      status: options.status,
      errorMessage: options.errorMessage
    })

    return this.snapshotProvider.getSessionSnapshot(session.id)
  }

  private createMessageRecord(
    session: GetAgentSessionResponse,
    options: {
      id: string
      role: 'user' | 'assistant'
      status: 'success' | 'processing' | 'error'
      content: string
      createdAt: string
      updatedAt: string
      agentSessionId: string
    }
  ): PersistedRemoteMessage {
    const blockId = `${options.id}:main`

    return {
      id: options.id,
      role: options.role,
      assistantId: session.agent_id,
      topicId: session.id,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
      status: options.status as PersistedRemoteMessage['status'],
      blocks: [blockId],
      agentSessionId: options.agentSessionId,
      content: options.content
    } as PersistedRemoteMessage
  }

  private createMainTextBlock(
    messageId: string,
    content: string,
    overrides: {
      id?: string
      createdAt: string
      updatedAt: string
      status: 'success' | 'streaming' | 'error'
      error?: PersistedRemoteBlock['error']
    }
  ): PersistedRemoteBlock {
    return {
      id: overrides.id ?? `${messageId}:main`,
      messageId,
      type: 'main_text',
      content,
      createdAt: overrides.createdAt,
      updatedAt: overrides.updatedAt,
      status: overrides.status,
      error: overrides.error
    } as PersistedRemoteBlock
  }
}
