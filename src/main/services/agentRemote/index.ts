import { AgentRemoteService } from './AgentRemoteService'

export { AgentRemoteService } from './AgentRemoteService'
export { AgentRemoteService as default } from './AgentRemoteService'
export { BridgeSocketClient } from './BridgeSocketClient'
export { CommandExecutionService } from './CommandExecutionService'
export { createAgentRemoteConfig, defaultAgentRemoteConfig } from './config'
export { EventPublisher } from './EventPublisher'
export { RunRegistrationService } from './RunRegistrationService'
export { SnapshotProvider } from './SnapshotProvider'
export { SseEventAdapter } from './SseEventAdapter'
export type {
  AgentRemoteConfig,
  AgentRemoteStatus,
  BridgePresencePayload,
  PushSessionInput,
  RegisterDesktopRunInput,
  RemoteConnectionState,
  RemoteEnvelope,
  SessionPushedPayload,
  SessionVersionBumpPayload
} from './types'
export const agentRemoteService = AgentRemoteService.getInstance()
