import type { AgentRemoteConfig } from './types'

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 1_000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000
const DEFAULT_RECONNECT_BACKOFF_MULTIPLIER = 2
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }

  if (value === '1' || value.toLowerCase() === 'true') {
    return true
  }

  if (value === '0' || value.toLowerCase() === 'false') {
    return false
  }

  return fallback
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function createAgentRemoteConfig(overrides: Partial<AgentRemoteConfig> = {}): AgentRemoteConfig {
  return {
    enabled: overrides.enabled ?? parseBoolean(process.env.CHERRY_REMOTE_ENABLED, false),
    relayUrl: overrides.relayUrl ?? process.env.CHERRY_REMOTE_RELAY_URL ?? null,
    authToken: overrides.authToken ?? process.env.CHERRY_REMOTE_AUTH_TOKEN ?? null,
    deviceId: overrides.deviceId ?? process.env.CHERRY_REMOTE_DEVICE_ID ?? `desktop-${process.pid}`,
    clientId: overrides.clientId ?? process.env.CHERRY_REMOTE_CLIENT_ID ?? 'cherry-studio-desktop',
    heartbeatIntervalMs:
      overrides.heartbeatIntervalMs ??
      parseNumber(process.env.CHERRY_REMOTE_HEARTBEAT_MS, DEFAULT_HEARTBEAT_INTERVAL_MS),
    reconnectInitialDelayMs:
      overrides.reconnectInitialDelayMs ??
      parseNumber(process.env.CHERRY_REMOTE_RECONNECT_INITIAL_MS, DEFAULT_RECONNECT_INITIAL_DELAY_MS),
    reconnectMaxDelayMs:
      overrides.reconnectMaxDelayMs ??
      parseNumber(process.env.CHERRY_REMOTE_RECONNECT_MAX_MS, DEFAULT_RECONNECT_MAX_DELAY_MS),
    reconnectBackoffMultiplier:
      overrides.reconnectBackoffMultiplier ??
      parseNumber(process.env.CHERRY_REMOTE_RECONNECT_BACKOFF, DEFAULT_RECONNECT_BACKOFF_MULTIPLIER),
    connectTimeoutMs:
      overrides.connectTimeoutMs ??
      parseNumber(process.env.CHERRY_REMOTE_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS)
  }
}

export const defaultAgentRemoteConfig = createAgentRemoteConfig()
