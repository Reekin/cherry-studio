import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { sessionMessageService, sessionService } from '@main/services/agents'

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
    const messageId = envelope.payload.messageId ?? `assistant:${runId}`

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

      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        {
          content: envelope.payload.content
        },
        new AbortController()
      )

      for await (const remoteEvent of this.sseEventAdapter.adaptStream(stream, {
        sessionId: envelope.payload.sessionId,
        requestId: envelope.requestId,
        runId,
        messageId
      })) {
        this.eventPublisher.publishEnvelope(remoteEvent)
      }

      await completion

      const snapshot = await this.snapshotProvider.getSessionSnapshot(envelope.payload.sessionId)
      const updatedAt = snapshot?.updatedAt ?? Date.now()
      const version = snapshot?.snapshotVersion ?? 0

      this.eventPublisher.publishEnvelope(
        createRemoteEventEnvelope(
          'message.done',
          {
            sessionId: envelope.payload.sessionId,
            runId,
            messageId,
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

      this.eventPublisher.publishEnvelope(
        createRemoteEventEnvelope(
          'message.error',
          {
            sessionId: envelope.payload.sessionId,
            runId,
            messageId,
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

      return {
        accepted: false,
        reason: 'message_send_failed',
        responseEnvelope
      }
    }
  }

  private async handleSnapshot(envelope: Extract<RemoteCommandEnvelope, { event: 'session.snapshot' }>) {
    const snapshot = await this.snapshotProvider.getSessionSnapshot(envelope.payload.sessionId)

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
}
