import { loggerService } from '@logger'

import { BridgeSocketClient } from './BridgeSocketClient'
import { CommandExecutionService } from './CommandExecutionService'
import { createAgentRemoteConfig } from './config'
import { EventPublisher } from './EventPublisher'
import { RunRegistrationService } from './RunRegistrationService'
import { SnapshotProvider } from './SnapshotProvider'
import { SseEventAdapter } from './SseEventAdapter'
import type {
  AgentRemoteConfig,
  AgentRemotePublishedEvent,
  AgentRemoteStatus,
  PushSessionInput,
  RegisterDesktopRunInput,
  RemoteEnvelope,
  SessionPushedPayload,
  SessionVersionBumpPayload
} from './types'

const logger = loggerService.withContext('AgentRemoteService')

export class AgentRemoteService {
  private static instance: AgentRemoteService | null = null
  private readonly listeners = new Set<(status: AgentRemoteStatus) => void>()
  private readonly publishedEventListeners = new Set<(event: AgentRemotePublishedEvent) => void>()

  private readonly config: AgentRemoteConfig
  private readonly socketClient: BridgeSocketClient
  private readonly eventPublisher: EventPublisher
  private readonly runRegistrationService: RunRegistrationService
  private readonly commandExecutionService: CommandExecutionService
  private readonly sseEventAdapter: SseEventAdapter
  private readonly snapshotProvider: SnapshotProvider
  private status: AgentRemoteStatus

  static getInstance(config: Partial<AgentRemoteConfig> = {}): AgentRemoteService {
    if (!AgentRemoteService.instance) {
      AgentRemoteService.instance = new AgentRemoteService(createAgentRemoteConfig(config))
    }
    return AgentRemoteService.instance
  }

  private constructor(config: AgentRemoteConfig) {
    this.config = config
    this.socketClient = new BridgeSocketClient(config)
    this.eventPublisher = new EventPublisher(this.socketClient, config.deviceId, (event) =>
      this.emitPublishedEvent(event)
    )
    this.runRegistrationService = new RunRegistrationService(this.socketClient, config.deviceId)
    this.sseEventAdapter = new SseEventAdapter()
    this.snapshotProvider = new SnapshotProvider()
    this.commandExecutionService = new CommandExecutionService(
      this.eventPublisher,
      this.sseEventAdapter,
      this.snapshotProvider
    )
    this.status = {
      enabled: config.enabled,
      relayUrl: config.relayUrl,
      deviceId: config.deviceId,
      state: 'idle',
      bridgeOnline: false,
      updatedAt: Date.now()
    }

    this.socketClient.on('open', () => {
      this.updateStatus({ state: 'online', bridgeOnline: true, lastError: undefined })
      this.eventPublisher.publishOnline()
    })

    this.socketClient.on('close', (reason) => {
      this.updateStatus({
        state: 'offline',
        bridgeOnline: false,
        lastError: reason
      })
      logger.info('Remote bridge connection transitioned offline', { reason })
    })

    this.socketClient.on('message', (envelope) => {
      void this.handleIncomingEnvelope(envelope)
    })

    this.socketClient.on('error', (error) => {
      this.updateStatus({
        state: 'offline',
        bridgeOnline: false,
        lastError: error.message
      })
      logger.error('Remote bridge socket error', {
        error: error.message
      })
    })

    this.socketClient.on('state', (state) => {
      this.updateStatus({ state })
    })
  }

  start(): void {
    this.updateStatus({ state: 'connecting' })
    this.socketClient.start()
  }

  stop(reason?: string): void {
    if (this.socketClient.state === 'online') {
      this.eventPublisher.publishOffline(reason ?? 'service_stop')
    }

    this.socketClient.stop(reason)
    this.updateStatus({ state: 'stopped', bridgeOnline: false })
  }

  registerDesktopRun(input: RegisterDesktopRunInput): { accepted: boolean; requestId: string } {
    return this.runRegistrationService.registerDesktopRun(input)
  }

  publishSessionPushed(payload: SessionPushedPayload): boolean {
    return this.eventPublisher.publishSessionPushed(payload)
  }

  publishSessionVersionBump(payload: SessionVersionBumpPayload): boolean {
    return this.eventPublisher.publishSessionVersionBump(payload)
  }

  pushSession(input: PushSessionInput): boolean {
    return this.publishSessionPushed({
      sessionId: input.sessionId,
      agentId: input.agentId,
      pushedAt: Date.now()
    })
  }

  getCommandExecutionService(): CommandExecutionService {
    return this.commandExecutionService
  }

  getSseEventAdapter(): SseEventAdapter {
    return this.sseEventAdapter
  }

  getSnapshotProvider(): SnapshotProvider {
    return this.snapshotProvider
  }

  getConfig(): AgentRemoteConfig {
    return this.config
  }

  reloadConfig(nextConfig: Partial<AgentRemoteConfig> = {}): AgentRemoteStatus {
    const resolvedConfig = createAgentRemoteConfig({
      ...this.config,
      ...nextConfig
    })

    this.config.enabled = resolvedConfig.enabled
    this.config.relayUrl = resolvedConfig.relayUrl
    this.config.authToken = resolvedConfig.authToken
    this.config.heartbeatIntervalMs = resolvedConfig.heartbeatIntervalMs
    this.config.reconnectInitialDelayMs = resolvedConfig.reconnectInitialDelayMs
    this.config.reconnectMaxDelayMs = resolvedConfig.reconnectMaxDelayMs
    this.config.reconnectBackoffMultiplier = resolvedConfig.reconnectBackoffMultiplier
    this.config.connectTimeoutMs = resolvedConfig.connectTimeoutMs

    this.updateStatus({
      enabled: resolvedConfig.enabled,
      relayUrl: resolvedConfig.relayUrl,
      lastError: undefined
    })

    this.stop('config_reload')

    if (resolvedConfig.enabled) {
      this.start()
    }

    return this.status
  }

  getStatus(): AgentRemoteStatus {
    return this.status
  }

  subscribe(listener: (status: AgentRemoteStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)

    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribePublishedEvents(listener: (event: AgentRemotePublishedEvent) => void): () => void {
    this.publishedEventListeners.add(listener)
    return () => {
      this.publishedEventListeners.delete(listener)
    }
  }

  private async handleIncomingEnvelope(envelope: RemoteEnvelope): Promise<void> {
    if (envelope.type !== 'cmd') {
      return
    }

    const result = await this.commandExecutionService.executeCommand(envelope)
    if (!result.accepted) {
      logger.info('Remote bridge command was not accepted', {
        event: envelope.event,
        requestId: envelope.requestId,
        reason: result.reason
      })

      if (result.responseEnvelope) {
        this.eventPublisher.publishEnvelope(result.responseEnvelope)
      }
    }
  }

  private updateStatus(partial: Partial<AgentRemoteStatus>): void {
    this.status = {
      ...this.status,
      ...partial,
      updatedAt: Date.now()
    }

    for (const listener of this.listeners) {
      listener(this.status)
    }
  }

  private emitPublishedEvent(event: AgentRemotePublishedEvent): void {
    for (const listener of this.publishedEventListeners) {
      listener(event)
    }
  }
}
