import { loggerService } from '@logger'

import { BridgeSocketClient } from './BridgeSocketClient'
import {
  type BridgePresencePayload,
  createRemoteEventEnvelope,
  type RemoteEnvelope,
  type SessionPushedPayload,
  type SessionVersionBumpPayload
} from './types'

const logger = loggerService.withContext('EventPublisher')

export class EventPublisher {
  constructor(
    private readonly socketClient: BridgeSocketClient,
    private readonly deviceId: string
  ) {}

  publishSessionPushed(payload: SessionPushedPayload): boolean {
    return this.publishEvent('session.pushed', payload)
  }

  publishSessionVersionBump(payload: SessionVersionBumpPayload): boolean {
    return this.publishEvent('session.version.bump', payload)
  }

  publishEnvelope(envelope: RemoteEnvelope): boolean {
    const sent = this.socketClient.send(envelope)

    if (!sent) {
      logger.warn('Failed to publish remote bridge envelope', {
        type: envelope.type,
        event: envelope.event,
        requestId: envelope.requestId,
        runId: envelope.runId
      })
    }

    return sent
  }

  publishOnline(_reason = 'socket_open'): boolean {
    return this.publishEvent('bridge.online', {
      deviceId: this.deviceId,
      status: 'online'
    })
  }

  publishOffline(_reason = 'socket_close'): boolean {
    return this.publishEvent('bridge.offline', {
      deviceId: this.deviceId,
      status: 'offline'
    })
  }

  private publishEvent(
    event: 'session.pushed' | 'session.version.bump' | 'bridge.online' | 'bridge.offline',
    payload: SessionPushedPayload | SessionVersionBumpPayload | BridgePresencePayload
  ): boolean {
    return this.publishEnvelope(createRemoteEventEnvelope(event, payload))
  }
}
