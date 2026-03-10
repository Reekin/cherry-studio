import { randomUUID } from 'node:crypto'

import type {
  RemoteAckEnvelope,
  RemoteCmdEnvelope,
  RemoteEnvelope as SharedRemoteEnvelope,
  RemoteErrEnvelope,
  RemoteErrorCode,
  RemoteEvtEnvelope
} from '@shared/agents/remote'

export type RemoteConnectionState = 'idle' | 'connecting' | 'online' | 'offline' | 'stopped'

export interface AgentRemoteConfig {
  enabled: boolean
  relayUrl: string | null
  authToken: string | null
  deviceId: string
  clientId: string
  heartbeatIntervalMs: number
  reconnectInitialDelayMs: number
  reconnectMaxDelayMs: number
  reconnectBackoffMultiplier: number
  connectTimeoutMs: number
}

export interface RegisterDesktopRunInput {
  runId: string
  sessionId: string
  agentId: string
}

export interface PushSessionInput {
  sessionId: string
  agentId: string
}

export interface SessionPushedPayload {
  sessionId: string
  agentId: string
  pushedAt: number
}

export interface SessionVersionBumpPayload {
  sessionId: string
  version: number
  updatedAt: number
}

export interface BridgePresencePayload {
  deviceId: string
  status: 'online' | 'offline'
}

export interface AgentRemoteStatus {
  enabled: boolean
  relayUrl: string | null
  deviceId: string
  state: RemoteConnectionState
  lastError?: string
  bridgeOnline: boolean
  updatedAt: number
}

export interface RemoteSocketListenerMap {
  open: () => void
  close: (reason?: string) => void
  message: (envelope: RemoteEnvelope) => void
  error: (error: Error) => void
  state: (state: RemoteConnectionState) => void
}

export interface SendRemoteEnvelopeOptions {
  requestId?: string
  runId?: string
}

export type RemoteCommandEnvelope = RemoteCmdEnvelope
export type RemoteEventEnvelope = RemoteEvtEnvelope
export type RemoteAckCommitEnvelope = RemoteAckEnvelope
export type RemoteErrorEnvelope = RemoteErrEnvelope
export type RemoteEnvelope = SharedRemoteEnvelope

export function createRemoteCommandEnvelope<TPayload>(
  event: RemoteCommandEnvelope['event'],
  payload: TPayload,
  options: SendRemoteEnvelopeOptions = {}
): RemoteCommandEnvelope {
  return {
    type: 'cmd',
    event,
    requestId: options.requestId ?? randomUUID(),
    runId: options.runId,
    ts: Date.now(),
    payload
  } as RemoteCommandEnvelope
}

export function createRemoteEventEnvelope<TPayload>(
  event: RemoteEventEnvelope['event'],
  payload: TPayload,
  options: SendRemoteEnvelopeOptions = {}
): RemoteEventEnvelope {
  return {
    type: 'evt',
    event,
    requestId: options.requestId,
    runId: options.runId,
    ts: Date.now(),
    payload
  } as RemoteEventEnvelope
}

export function createRemoteAckEnvelope(deviceId: string, ackSeq: number): RemoteAckCommitEnvelope {
  return {
    type: 'ack',
    event: 'ack.commit',
    ts: Date.now(),
    payload: {
      deviceId,
      ackSeq
    }
  }
}

export function createRemoteErrorEnvelope(
  code: RemoteErrorCode,
  message: string,
  options: {
    requestId?: string
    runId?: string
    retryable?: boolean
    sessionId?: string
  } = {}
): RemoteErrorEnvelope {
  return {
    type: 'err',
    event: 'error',
    requestId: options.requestId,
    runId: options.runId,
    ts: Date.now(),
    payload: {
      code,
      message,
      retryable: options.retryable ?? false,
      sessionId: options.sessionId
    }
  }
}
