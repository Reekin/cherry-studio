import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { agentService, sessionMessageService, sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database'
import type {
  AgentEntity,
  AgentPersistedMessage,
  CreateAgentRequest,
  GetAgentSessionResponse,
  UpdateAgentRequest
} from '@types'
import { AgentConfigurationSchema } from '@types'

import type { EventPublisher } from './EventPublisher'
import { RemoteMessageProjectionBuilder } from './RemoteMessageProjection'
import type { SnapshotProvider } from './SnapshotProvider'
import type { SseEventAdapter } from './SseEventAdapter'
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
      case 'agent.list':
        return this.handleListAgents(envelope)
      case 'agent.upsert':
        return this.handleUpsertAgent(envelope)
      case 'agent.delete':
        return this.handleDeleteAgent(envelope)
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

  private async handleListAgents(envelope: Extract<RemoteCommandEnvelope, { event: 'agent.list' }>) {
    try {
      const { agents } = await agentService.listAgents()
      const responseEnvelope = createRemoteEventEnvelope(
        'agent.listed',
        {
          agents: agents.map((agent) => this.toRemoteAgentPayload(agent))
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
      return {
        accepted: false,
        reason: 'agent_list_failed',
        responseEnvelope: createRemoteErrorEnvelope(
          'VALIDATION_FAILED',
          error instanceof Error ? error.message : 'Failed to list remote agents',
          {
            requestId: envelope.requestId,
            runId: envelope.runId
          }
        )
      }
    }
  }

  private async handleUpsertAgent(envelope: Extract<RemoteCommandEnvelope, { event: 'agent.upsert' }>) {
    try {
      const existingAgent = envelope.payload.agentId ? await agentService.getAgent(envelope.payload.agentId) : null
      if (envelope.payload.agentId && !existingAgent) {
        return {
          accepted: false,
          reason: 'agent_not_found',
          responseEnvelope: createRemoteErrorEnvelope('VALIDATION_FAILED', 'Remote agent not found', {
            requestId: envelope.requestId,
            runId: envelope.runId
          })
        }
      }

      const payload = await this.buildAgentUpsertPayload(envelope.payload, existingAgent)
      const agent = existingAgent
        ? await agentService.updateAgent(existingAgent.id, payload as UpdateAgentRequest)
        : await agentService.createAgent(payload as CreateAgentRequest)

      if (!agent) {
        return {
          accepted: false,
          reason: 'agent_upsert_failed',
          responseEnvelope: createRemoteErrorEnvelope('VALIDATION_FAILED', 'Failed to save remote agent', {
            requestId: envelope.requestId,
            runId: envelope.runId
          })
        }
      }

      const responseEnvelope = createRemoteEventEnvelope(
        'agent.upserted',
        {
          agent: this.toRemoteAgentPayload(agent)
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
      return {
        accepted: false,
        reason: 'agent_upsert_failed',
        responseEnvelope: createRemoteErrorEnvelope(
          'VALIDATION_FAILED',
          error instanceof Error ? error.message : 'Failed to save remote agent',
          {
            requestId: envelope.requestId,
            runId: envelope.runId
          }
        )
      }
    }
  }

  private async handleDeleteAgent(envelope: Extract<RemoteCommandEnvelope, { event: 'agent.delete' }>) {
    try {
      const deleted = await agentService.deleteAgent(envelope.payload.agentId)
      if (!deleted) {
        return {
          accepted: false,
          reason: 'agent_delete_failed',
          responseEnvelope: createRemoteErrorEnvelope('VALIDATION_FAILED', 'Remote agent not found', {
            requestId: envelope.requestId,
            runId: envelope.runId
          })
        }
      }

      const responseEnvelope = createRemoteEventEnvelope(
        'agent.deleted',
        {
          agentId: envelope.payload.agentId
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
      return {
        accepted: false,
        reason: 'agent_delete_failed',
        responseEnvelope: createRemoteErrorEnvelope(
          'VALIDATION_FAILED',
          error instanceof Error ? error.message : 'Failed to delete remote agent',
          {
            requestId: envelope.requestId,
            runId: envelope.runId
          }
        )
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
    let session: GetAgentSessionResponse | null = null
    let persisted: PersistedExchangeSnapshot | null = null
    let userMessagePersisted = false
    let projectionBuilder: RemoteMessageProjectionBuilder | null = null

    try {
      session = await sessionService.getSession(envelope.payload.agentId, envelope.payload.sessionId)

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

      persisted = await this.createPersistedExchangeSnapshot(session, envelope, runId, assistantMessageId)
      projectionBuilder = new RemoteMessageProjectionBuilder({
        messageId: assistantMessageId,
        agentId: session.agent_id,
        sessionId: session.id,
        agentSessionId: persisted.agentSessionId,
        runId
      })

      await this.persistUserMessage(session, envelope.payload.content, persisted)
      userMessagePersisted = true

      const { stream, completion } = await sessionMessageService.createSessionMessage(
        session,
        {
          content: envelope.payload.content
        },
        new AbortController()
      )

      await this.persistAssistantProjection(session, persisted.agentSessionId, projectionBuilder)
      const startedEvents = projectionBuilder.startStreaming(Date.now())
      if (shouldPublishStream) {
        for (const remoteEvent of this.sseEventAdapter.adaptEvents(startedEvents, {
          requestId: envelope.requestId,
          runId
        })) {
          this.eventPublisher.publishEnvelope(remoteEvent)
        }
      }

      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          const updatedAt = Date.now()
          const streamAgentSessionId = this.extractAgentSessionId(value)
          if (streamAgentSessionId && streamAgentSessionId !== persisted.agentSessionId) {
            persisted.agentSessionId = streamAgentSessionId
            projectionBuilder.setAgentSessionId(streamAgentSessionId)
            await this.persistUserMessage(session, envelope.payload.content, persisted)
            await this.persistAssistantProjection(session, persisted.agentSessionId, projectionBuilder)
          }

          const semanticEvents = projectionBuilder.applyPart(value, updatedAt)

          if (semanticEvents.length > 0) {
            await this.persistAssistantProjection(session, persisted.agentSessionId, projectionBuilder)
          }

          if (shouldPublishStream) {
            for (const remoteEvent of this.sseEventAdapter.adaptEvents(semanticEvents, {
              requestId: envelope.requestId,
              runId
            })) {
              this.eventPublisher.publishEnvelope(remoteEvent)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      await completion

      const completedEvents = projectionBuilder.finalize('success', {
        updatedAt: Date.now()
      })
      const snapshot = await this.finalizeAssistantPersistence(session, persisted.agentSessionId, projectionBuilder, {
        status: 'success'
      })
      const updatedAt = snapshot?.updatedAt ?? Date.now()
      const version = snapshot?.snapshotVersion ?? 0

      if (shouldPublishStream) {
        const finalizedEvents = completedEvents.map((event) =>
          event.event === 'message.completed'
            ? {
                ...event,
                payload: {
                  ...event.payload,
                  version,
                  updatedAt
                }
              }
            : event
        )

        for (const remoteEvent of this.sseEventAdapter.adaptEvents(finalizedEvents, {
          requestId: envelope.requestId,
          runId
        })) {
          this.eventPublisher.publishEnvelope(remoteEvent)
        }
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
        if (!session) {
          session = await sessionService.getSession(envelope.payload.agentId, envelope.payload.sessionId)
        }

        if (session) {
          persisted ??= await this.createPersistedExchangeSnapshot(session, envelope, runId, assistantMessageId)
          projectionBuilder ??= new RemoteMessageProjectionBuilder({
            messageId: assistantMessageId,
            agentId: session.agent_id,
            sessionId: session.id,
            agentSessionId: persisted.agentSessionId,
            runId
          })

          if (!userMessagePersisted) {
            await this.persistUserMessage(session, envelope.payload.content, persisted)
          }

          const failureEvents = projectionBuilder.finalize('error', {
            updatedAt: Date.now(),
            errorMessage: responseEnvelope.payload.message
          })
          const snapshot = await this.finalizeAssistantPersistence(
            session,
            persisted.agentSessionId,
            projectionBuilder,
            {
              status: 'error',
              errorMessage: responseEnvelope.payload.message
            }
          )

          if (shouldPublishStream) {
            const finalizedEvents = failureEvents.map((event) =>
              event.event === 'message.failed' && snapshot
                ? {
                    ...event,
                    payload: {
                      ...event.payload,
                      version: snapshot.snapshotVersion,
                      updatedAt: snapshot.updatedAt
                    }
                  }
                : event
            )

            for (const remoteEvent of this.sseEventAdapter.adaptEvents(finalizedEvents, {
              requestId: envelope.requestId,
              runId
            })) {
              this.eventPublisher.publishEnvelope(remoteEvent)
            }
          }
        }
      } catch (persistError) {
        logger.warn('Failed to persist remote error state', {
          error: persistError instanceof Error ? persistError.message : String(persistError),
          runId,
          sessionId: envelope.payload.sessionId
        })
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

  private async persistAssistantProjection(
    session: GetAgentSessionResponse,
    agentSessionId: string,
    projectionBuilder: RemoteMessageProjectionBuilder
  ): Promise<void> {
    await agentMessageRepository.persistExchange({
      sessionId: session.id,
      agentSessionId,
      assistant: {
        payload: projectionBuilder.toPersistedMessage()
      }
    })
  }

  private async finalizeAssistantPersistence(
    session: GetAgentSessionResponse,
    agentSessionId: string,
    projectionBuilder: RemoteMessageProjectionBuilder,
    _options: {
      status: 'success' | 'error'
      errorMessage?: string
    }
  ) {
    await this.persistAssistantProjection(session, agentSessionId, projectionBuilder)

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

  private extractAgentSessionId(part: { type: string; rawValue?: unknown }): string | undefined {
    if (part.type !== 'raw') {
      return undefined
    }

    const raw = part.rawValue
    if (!raw || typeof raw !== 'object') {
      return undefined
    }

    if (!('session_id' in raw) || typeof raw.session_id !== 'string') {
      return undefined
    }

    return raw.session_id.trim() || undefined
  }

  private toRemoteAgentPayload(agent: AgentEntity) {
    return {
      agentId: agent.id,
      name: agent.name ?? 'Agent',
      prompt: agent.instructions ?? '',
      directories: agent.accessible_paths ?? [],
      provider: agent.type,
      permissionMode: agent.configuration?.permission_mode ?? 'bypassPermissions',
      createdAt: Date.parse(agent.created_at),
      updatedAt: Date.parse(agent.updated_at)
    } as const
  }

  private async buildAgentUpsertPayload(
    payload: Extract<RemoteCommandEnvelope, { event: 'agent.upsert' }>['payload'],
    existingAgent: Awaited<ReturnType<typeof agentService.getAgent>>
  ): Promise<CreateAgentRequest | UpdateAgentRequest> {
    const type = payload.provider
    const model = this.resolveAgentModel(type, existingAgent?.model)

    const basePayload = {
      type,
      name: payload.name.trim(),
      instructions: payload.prompt,
      accessible_paths: payload.directories,
      configuration: AgentConfigurationSchema.parse({
        ...existingAgent?.configuration,
        permission_mode: payload.permissionMode
      }),
      model: model ?? (await this.resolveDefaultModel(type))
    }

    if (existingAgent) {
      return {
        ...basePayload,
        model: model ?? existingAgent.model
      }
    }

    return {
      ...basePayload,
      model: basePayload.model
    }
  }

  private resolveAgentModel(
    provider: Extract<RemoteCommandEnvelope, { event: 'agent.upsert' }>['payload']['provider'],
    existingModel?: string
  ): string | undefined {
    if (provider === 'codex') {
      return ''
    }

    if (existingModel && existingModel.trim().length > 0) {
      return existingModel
    }

    return undefined
  }

  private async resolveDefaultModel(
    provider: Extract<RemoteCommandEnvelope, { event: 'agent.upsert' }>['payload']['provider']
  ): Promise<string> {
    if (provider === 'codex') {
      return ''
    }

    const { getAvailableProviders } = await import('@main/apiServer/utils')
    const providers = await getAvailableProviders()
    const firstAvailableModel = providers.flatMap((item) => item.models ?? []).find((model) => model.id)

    if (!firstAvailableModel) {
      throw new Error('No enabled desktop model is available to create a remote agent')
    }

    return `${firstAvailableModel.provider}:${firstAvailableModel.id}`
  }
}
