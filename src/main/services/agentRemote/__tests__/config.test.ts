import { describe, expect, it } from 'vitest'

import { createAgentRemoteConfig } from '../config'

describe('createAgentRemoteConfig', () => {
  it('merges explicit overrides over environment defaults', () => {
    const config = createAgentRemoteConfig({
      enabled: true,
      relayUrl: 'wss://relay.example.test/bridge',
      heartbeatIntervalMs: 5_000
    })

    expect(config.enabled).toBe(true)
    expect(config.relayUrl).toBe('wss://relay.example.test/bridge')
    expect(config.heartbeatIntervalMs).toBe(5_000)
  })
})
