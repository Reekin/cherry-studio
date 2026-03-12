import { describe, expect, it } from 'vitest'

import { CreateSessionRequestSchema, ReplaceSessionRequestSchema, UpdateSessionRequestSchema } from '../agent'

describe('session request schemas', () => {
  it('allows Codex create-session requests with an empty model', () => {
    const result = CreateSessionRequestSchema.safeParse({
      type: 'codex',
      accessible_paths: [],
      model: ''
    })

    expect(result.success).toBe(true)
  })

  it('rejects Claude Code create-session requests with an empty model', () => {
    const result = CreateSessionRequestSchema.safeParse({
      type: 'claude-code',
      accessible_paths: [],
      model: ''
    })

    expect(result.success).toBe(false)
  })

  it('allows Codex replace-session requests when agent_type is provided', () => {
    const result = ReplaceSessionRequestSchema.safeParse({
      agent_type: 'codex',
      accessible_paths: [],
      model: ''
    })

    expect(result.success).toBe(true)
  })

  it('allows Codex update-session requests to keep an empty model', () => {
    const result = UpdateSessionRequestSchema.safeParse({
      type: 'codex',
      model: ''
    })

    expect(result.success).toBe(true)
  })
})
