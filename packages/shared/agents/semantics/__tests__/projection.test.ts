import { describe, expect, it } from 'vitest'

import {
  createSemanticSessionProjection,
  createSemanticSessionSnapshotV2,
  projectionFromSemanticSessionSnapshotV2,
  reduceSemanticEvents,
  semanticSessionSnapshotV2Schema
} from '..'

describe('semantic projection helpers', () => {
  it('reduces semantic events into a deterministic message and block projection', () => {
    const projection = reduceSemanticEvents(
      [
        {
          event: 'message.started',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            role: 'assistant',
            status: 'streaming',
            createdAt: 100,
            updatedAt: 100
          }
        },
        {
          event: 'message.block.added',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            block: {
              blockId: 'block-main',
              messageId: 'assistant-1',
              type: 'main_text',
              status: 'streaming',
              order: 1,
              createdAt: 102,
              updatedAt: 102,
              content: {
                text: 'Hel'
              }
            }
          }
        },
        {
          event: 'message.block.added',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            block: {
              blockId: 'block-thinking',
              messageId: 'assistant-1',
              type: 'thinking',
              status: 'streaming',
              order: 0,
              createdAt: 101,
              updatedAt: 101,
              content: 'thinking'
            }
          }
        },
        {
          event: 'message.block.updated',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            blockId: 'block-main',
            patch: {
              content: {
                text: 'Hello world'
              }
            },
            updatedAt: 103
          }
        },
        {
          event: 'message.block.completed',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            blockId: 'block-thinking',
            status: 'success',
            updatedAt: 104
          }
        },
        {
          event: 'message.completed',
          payload: {
            sessionId: 'session-1',
            runId: 'run-codex-1',
            messageId: 'assistant-1',
            status: 'success',
            version: 2,
            updatedAt: 105
          }
        }
      ],
      createSemanticSessionProjection({
        sessionId: 'session-1'
      })
    )

    expect(projection.version).toBe(2)
    expect(projection.updatedAt).toBe(105)
    expect(projection.messages).toHaveLength(1)
    expect(projection.messages[0]).toMatchObject({
      messageId: 'assistant-1',
      runId: 'run-codex-1',
      status: 'success',
      blockIds: ['block-thinking', 'block-main']
    })
    expect(projection.blocks.map((block) => block.blockId)).toEqual(['block-thinking', 'block-main'])
    expect(projection.blocks[0]).toMatchObject({
      type: 'thinking',
      status: 'success'
    })
    expect(projection.blocks[1]).toMatchObject({
      type: 'main_text',
      content: {
        text: 'Hello world'
      }
    })
  })

  it('round-trips snapshot v2 with normalized ordering and block ids', () => {
    const snapshot = createSemanticSessionSnapshotV2(
      createSemanticSessionProjection({
        sessionId: 'session-2',
        version: 7,
        updatedAt: 300,
        messages: [
          {
            messageId: 'assistant-2',
            sessionId: 'session-2',
            runId: 'run-2',
            role: 'assistant',
            status: 'error',
            createdAt: 200,
            updatedAt: 300,
            blockIds: [],
            error: {
              code: 'PROVIDER_STREAM_FAILED',
              message: 'stream aborted',
              retryable: true
            }
          }
        ],
        blocks: [
          {
            blockId: 'block-error',
            messageId: 'assistant-2',
            type: 'error',
            status: 'error',
            order: 1,
            createdAt: 220,
            updatedAt: 300,
            content: {
              code: 'PROVIDER_STREAM_FAILED',
              message: 'stream aborted',
              retryable: true
            }
          },
          {
            blockId: 'block-main',
            messageId: 'assistant-2',
            type: 'main_text',
            status: 'success',
            order: 0,
            createdAt: 210,
            updatedAt: 250,
            content: {
              text: 'Partial answer'
            }
          }
        ]
      }),
      88
    )

    const parsedSnapshot = semanticSessionSnapshotV2Schema.parse(snapshot)
    const restoredProjection = projectionFromSemanticSessionSnapshotV2(parsedSnapshot)

    expect(parsedSnapshot.snapshotVersion).toBe(2)
    expect(parsedSnapshot.snapshotSeqCeiling).toBe(88)
    expect(restoredProjection.messages[0].blockIds).toEqual(['block-main', 'block-error'])
    expect(restoredProjection.blocks.map((block) => block.blockId)).toEqual(['block-main', 'block-error'])
    expect(restoredProjection.messages[0].error).toEqual({
      code: 'PROVIDER_STREAM_FAILED',
      message: 'stream aborted',
      retryable: true
    })
  })
})
