import { describe, expect, it } from 'vitest'

import { remoteEnvelopeSchema, remoteEvtEnvelopeSchema, remoteSnapshotResponseSchema } from '..'

describe('remote semantic schemas', () => {
  it('parses semantic remote events with provider-agnostic run ids', () => {
    const envelope = remoteEvtEnvelopeSchema.parse({
      type: 'evt',
      event: 'message.block.updated',
      runId: 'run-codex-1',
      ts: 1700000000000,
      payload: {
        sessionId: 'session-1',
        runId: 'run-codex-1',
        messageId: 'assistant-1',
        blockId: 'block-main',
        patch: {
          content: {
            text: 'Hello from semantic blocks'
          }
        },
        updatedAt: 1700000000123
      }
    })

    if (envelope.event !== 'message.block.updated') {
      throw new Error('Expected a semantic block update envelope')
    }

    expect(envelope.event).toBe('message.block.updated')
    expect(envelope.runId).toBe('run-codex-1')
    expect(envelope.payload.patch.content).toEqual({
      text: 'Hello from semantic blocks'
    })
  })

  it('parses snapshot v2 payloads using the shared semantic schema', () => {
    const snapshotV2 = remoteSnapshotResponseSchema.parse({
      sessionId: 'session-v2',
      snapshotVersion: 2,
      snapshotSeqCeiling: 10,
      version: 3,
      updatedAt: 300,
      messages: [
        {
          messageId: 'assistant-v2',
          sessionId: 'session-v2',
          runId: 'run-codex-2',
          role: 'assistant',
          status: 'success',
          createdAt: 250,
          updatedAt: 300,
          blockIds: ['block-main']
        }
      ],
      blocks: [
        {
          blockId: 'block-main',
          messageId: 'assistant-v2',
          type: 'main_text',
          status: 'success',
          order: 0,
          createdAt: 260,
          updatedAt: 300,
          content: {
            text: 'snapshot v2 text'
          }
        }
      ]
    })

    expect('blocks' in snapshotV2).toBe(true)
    expect(snapshotV2.snapshotVersion).toBe(2)
  })

  it('accepts first-class semantic envelopes for both start and completion events', () => {
    const semanticEnvelope = remoteEnvelopeSchema.parse({
      type: 'evt',
      event: 'message.started',
      ts: 1700000001000,
      payload: {
        sessionId: 'session-2',
        runId: 'run-semantic',
        messageId: 'assistant-2',
        role: 'assistant',
        status: 'streaming',
        createdAt: 1700000001000,
        updatedAt: 1700000001000
      }
    })

    const completedEnvelope = remoteEnvelopeSchema.parse({
      type: 'evt',
      event: 'message.completed',
      ts: 1700000001001,
      payload: {
        sessionId: 'session-2',
        runId: 'run-semantic',
        messageId: 'assistant-2',
        status: 'success',
        updatedAt: 1700000001001
      }
    })

    expect(semanticEnvelope.event).toBe('message.started')
    expect(completedEnvelope.event).toBe('message.completed')
  })
})
