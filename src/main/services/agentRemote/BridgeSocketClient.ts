import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import { remoteEnvelopeSchema } from '@shared/agents/remote'

import {
  type AgentRemoteConfig,
  createRemoteEventEnvelope,
  type RemoteConnectionState,
  type RemoteEnvelope,
  type RemoteSocketListenerMap
} from './types'

const logger = loggerService.withContext('BridgeSocketClient')

type BridgeSocketClientEvent = keyof RemoteSocketListenerMap

export class BridgeSocketClient {
  private readonly emitter = new EventEmitter()
  private readonly config: AgentRemoteConfig
  private socket: WebSocket | null = null
  private connectionState: RemoteConnectionState = 'idle'
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private connectTimeoutTimer: NodeJS.Timeout | null = null
  private started = false
  private manuallyStopped = false

  constructor(config: AgentRemoteConfig) {
    this.config = config
  }

  get state(): RemoteConnectionState {
    return this.connectionState
  }

  on<TEvent extends BridgeSocketClientEvent>(event: TEvent, listener: RemoteSocketListenerMap[TEvent]): void {
    this.emitter.on(event, listener)
  }

  off<TEvent extends BridgeSocketClientEvent>(event: TEvent, listener: RemoteSocketListenerMap[TEvent]): void {
    this.emitter.off(event, listener)
  }

  start(): void {
    if (!this.config.enabled) {
      logger.info('Agent remote bridge disabled; skipping socket start')
      return
    }

    if (!this.config.relayUrl) {
      logger.warn('Agent remote relay URL missing; skipping socket start')
      return
    }

    if (this.started) {
      return
    }

    this.started = true
    this.manuallyStopped = false
    this.connect()
  }

  stop(reason = 'manual_stop'): void {
    this.manuallyStopped = true
    this.started = false
    this.clearReconnectTimer()
    this.clearConnectTimeout()
    this.stopHeartbeat()
    this.setState('stopped')

    if (this.socket) {
      this.socket.close(1000, reason)
      this.socket = null
    }
  }

  send(envelope: RemoteEnvelope): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.warn('Skipped remote send because socket is not open', {
        type: envelope.type,
        requestId: envelope.requestId,
        state: this.connectionState
      })
      return false
    }

    this.socket.send(JSON.stringify(envelope))
    return true
  }

  private connect(): void {
    if (!this.config.relayUrl) {
      return
    }

    this.clearReconnectTimer()
    this.clearConnectTimeout()
    this.setState('connecting')

    const targetUrl = this.buildSocketUrl(this.config.relayUrl)

    logger.info('Connecting agent remote bridge socket', {
      relayUrl: targetUrl,
      attempt: this.reconnectAttempts + 1
    })

    const socket = new WebSocket(targetUrl)

    this.socket = socket
    this.connectTimeoutTimer = setTimeout(() => {
      logger.warn('Agent remote bridge socket connect timeout reached')
      socket.close(4000, 'connect_timeout')
    }, this.config.connectTimeoutMs)

    socket.onopen = () => {
      this.clearConnectTimeout()
      this.reconnectAttempts = 0
      this.setState('online')
      this.startHeartbeat()
      logger.info('Agent remote bridge socket connected')
      this.emitter.emit('open')
    }

    socket.onclose = (event) => {
      const reason = event.reason || `code_${event.code}`
      this.clearConnectTimeout()
      this.stopHeartbeat()
      this.socket = null
      this.setState(this.manuallyStopped ? 'stopped' : 'offline')
      logger.warn('Agent remote bridge socket closed', {
        code: event.code,
        reason,
        wasClean: event.wasClean
      })
      this.emitter.emit('close', reason)

      if (!this.manuallyStopped && this.started) {
        this.scheduleReconnect()
      }
    }

    socket.onerror = () => {
      const error = new Error('Agent remote bridge socket encountered an error')
      logger.error('Agent remote bridge socket error')
      this.emitter.emit('error', error)
    }

    socket.onmessage = (event) => {
      try {
        const envelope = remoteEnvelopeSchema.parse(JSON.parse(String(event.data))) as RemoteEnvelope
        this.emitter.emit('message', envelope)
      } catch (error) {
        logger.warn('Failed to parse remote bridge message', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()

    const delay = Math.min(
      this.config.reconnectInitialDelayMs *
        this.config.reconnectBackoffMultiplier ** Math.max(this.reconnectAttempts, 0),
      this.config.reconnectMaxDelayMs
    )
    this.reconnectAttempts += 1

    logger.info('Scheduling agent remote bridge reconnect', {
      delay,
      attempt: this.reconnectAttempts
    })

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return
      }

      const heartbeatPayload = JSON.stringify(
        createRemoteEventEnvelope('bridge.online', {
          deviceId: this.config.deviceId,
          status: 'online'
        })
      )

      this.socket.send(heartbeatPayload)
    }, this.config.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
  }

  private setState(state: RemoteConnectionState): void {
    this.connectionState = state
    this.emitter.emit('state', state)
  }

  private buildSocketUrl(relayUrl: string): string {
    const url = new URL(relayUrl)
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/ws/desktop'
    }

    if (this.config.authToken) {
      url.searchParams.set('key', this.config.authToken)
    }

    url.searchParams.set('deviceId', this.config.deviceId)

    return url.toString()
  }
}
