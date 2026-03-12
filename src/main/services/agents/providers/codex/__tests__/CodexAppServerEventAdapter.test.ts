import { describe, expect, it } from 'vitest'

import { CodexAppServerEventAdapter } from '../CodexAppServerEventAdapter'
import { CodexProvider } from '../CodexProvider'
import type { CodexAppServerEvent } from '../types'

describe('CodexAppServerEventAdapter', () => {
  it('maps agent message deltas into AiSDK text parts and finishes the step with usage', () => {
    const adapter = new CodexAppServerEventAdapter()
    const events: CodexAppServerEvent[] = [
      {
        type: 'turn.started',
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'inProgress',
          items: []
        }
      },
      {
        type: 'agent.message.delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Hello '
      },
      {
        type: 'agent.message.delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'world'
      },
      {
        type: 'thread.token.usage.updated',
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            totalTokens: 24,
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 14,
            reasoningOutputTokens: 4
          },
          last: {
            totalTokens: 24,
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 14,
            reasoningOutputTokens: 4
          }
        }
      },
      {
        type: 'item.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'agentMessage',
          id: 'msg-1',
          text: 'Hello world',
          phase: 'output'
        }
      },
      {
        type: 'turn.completed',
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: []
        }
      }
    ]

    const parts = events.flatMap((event) => adapter.adapt(event))

    expect(parts.map((part) => part.type)).toEqual([
      'start-step',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish-step',
      'finish'
    ])

    const finishStep = parts.at(-2)
    expect(finishStep?.type).toBe('finish-step')
    if (finishStep?.type === 'finish-step') {
      expect(finishStep.usage).toMatchObject({
        inputTokens: 10,
        outputTokens: 14,
        totalTokens: 24
      })
      expect(finishStep.finishReason).toBe('stop')
    }

    const finish = parts.at(-1)
    expect(finish?.type).toBe('finish')
    if (finish?.type === 'finish') {
      expect(finish.totalUsage).toMatchObject({
        inputTokens: 10,
        outputTokens: 14,
        totalTokens: 24
      })
      expect(finish.finishReason).toBe('stop')
    }
  })

  it('maps tool-like items and reasoning items into generic stream parts', () => {
    const adapter = new CodexAppServerEventAdapter()
    const events: CodexAppServerEvent[] = [
      {
        type: 'turn.started',
        threadId: 'thread-2',
        turn: {
          id: 'turn-2',
          status: 'inProgress',
          items: []
        }
      },
      {
        type: 'item.started',
        threadId: 'thread-2',
        turnId: 'turn-2',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'pwd',
          cwd: '/tmp',
          status: 'running'
        }
      },
      {
        type: 'item.completed',
        threadId: 'thread-2',
        turnId: 'turn-2',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'pwd',
          cwd: '/tmp',
          status: 'completed',
          aggregatedOutput: '/tmp',
          exitCode: 0,
          durationMs: 12
        }
      },
      {
        type: 'item.started',
        threadId: 'thread-2',
        turnId: 'turn-2',
        item: {
          type: 'reasoning',
          id: 'reason-1',
          summary: [],
          content: []
        }
      },
      {
        type: 'reasoning.summary.delta',
        threadId: 'thread-2',
        turnId: 'turn-2',
        itemId: 'reason-1',
        delta: 'Inspecting workspace',
        summaryIndex: 0
      },
      {
        type: 'item.completed',
        threadId: 'thread-2',
        turnId: 'turn-2',
        item: {
          type: 'reasoning',
          id: 'reason-1',
          summary: ['Inspecting workspace'],
          content: []
        }
      },
      {
        type: 'turn.completed',
        threadId: 'thread-2',
        turn: {
          id: 'turn-2',
          status: 'completed',
          items: []
        }
      }
    ]

    const parts = events.flatMap((event) => adapter.adapt(event))

    expect(parts.map((part) => part.type)).toEqual([
      'start-step',
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'finish-step',
      'finish'
    ])

    const toolResult = parts.find((part) => part.type === 'tool-result')
    expect(toolResult?.type).toBe('tool-result')
    if (toolResult?.type === 'tool-result') {
      expect(toolResult.toolCallId).toBe('cmd-1')
      expect(toolResult.output).toMatchObject({
        aggregatedOutput: '/tmp',
        exitCode: 0
      })
    }
  })

  it('maps file changes into generic tool chunks', () => {
    const adapter = new CodexAppServerEventAdapter()
    const events: CodexAppServerEvent[] = [
      {
        type: 'turn.started',
        threadId: 'thread-3',
        turn: {
          id: 'turn-3',
          status: 'inProgress',
          items: []
        }
      },
      {
        type: 'item.started',
        threadId: 'thread-3',
        turnId: 'turn-3',
        item: {
          type: 'fileChange',
          id: 'file-1',
          changes: [
            {
              path: '/tmp/ffff.txt',
              kind: { type: 'add' },
              diff: ''
            }
          ],
          status: 'inProgress'
        }
      },
      {
        type: 'item.completed',
        threadId: 'thread-3',
        turnId: 'turn-3',
        item: {
          type: 'fileChange',
          id: 'file-1',
          changes: [
            {
              path: '/tmp/ffff.txt',
              kind: { type: 'add' },
              diff: ''
            }
          ],
          status: 'completed'
        }
      },
      {
        type: 'turn.completed',
        threadId: 'thread-3',
        turn: {
          id: 'turn-3',
          status: 'completed',
          items: []
        }
      }
    ]

    const parts = events.flatMap((event) => adapter.adapt(event))

    expect(parts.map((part) => part.type)).toEqual([
      'start-step',
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
      'finish-step',
      'finish'
    ])

    const toolCall = parts.find((part) => part.type === 'tool-call')
    expect(toolCall?.type).toBe('tool-call')
    if (toolCall?.type === 'tool-call') {
      expect(toolCall.toolName).toBe('file_change')
      expect(toolCall.input).toMatchObject({
        changes: [
          expect.objectContaining({
            path: '/tmp/ffff.txt'
          })
        ]
      })
    }

    const toolResult = parts.find((part) => part.type === 'tool-result')
    expect(toolResult?.type).toBe('tool-result')
    if (toolResult?.type === 'tool-result') {
      expect(toolResult.toolCallId).toBe('file-1')
      expect(toolResult.output).toMatchObject({
        status: 'completed',
        changes: [
          expect.objectContaining({
            path: '/tmp/ffff.txt'
          })
        ]
      })
    }
  })
})

describe('CodexProvider', () => {
  it('emits init raw chunk before adapted Codex app-server events', async () => {
    const provider = new CodexProvider({
      runTurn: async () => ({
        threadId: 'thread-42',
        events: (async function* () {
          yield {
            type: 'turn.started',
            threadId: 'thread-42',
            turn: {
              id: 'turn-42',
              status: 'inProgress',
              items: []
            }
          } satisfies CodexAppServerEvent
          yield {
            type: 'agent.message.delta',
            threadId: 'thread-42',
            turnId: 'turn-42',
            itemId: 'msg-42',
            delta: 'hello'
          } satisfies CodexAppServerEvent
          yield {
            type: 'item.completed',
            threadId: 'thread-42',
            turnId: 'turn-42',
            item: {
              type: 'agentMessage',
              id: 'msg-42',
              text: 'hello',
              phase: 'output'
            }
          } satisfies CodexAppServerEvent
          yield {
            type: 'turn.completed',
            threadId: 'thread-42',
            turn: {
              id: 'turn-42',
              status: 'completed',
              items: [],
              error: null
            }
          } satisfies CodexAppServerEvent
        })()
      })
    } as any)

    const stream = await provider.invoke(
      'hello',
      {
        id: 'session-1',
        agent_id: 'agent-1',
        agent_type: 'codex',
        name: 'Codex Session',
        accessible_paths: ['I:/workspace'],
        instructions: 'Test',
        model: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any,
      new AbortController()
    )

    const events = await new Promise<any[]>((resolve, reject) => {
      const seen: any[] = []
      stream.on('data', (event) => {
        seen.push(event)
        if (event.type === 'complete' || event.type === 'cancelled') {
          resolve(seen)
        }
        if (event.type === 'error') {
          reject(event.error)
        }
      })
    })

    expect(events[0]).toMatchObject({
      type: 'chunk',
      chunk: {
        type: 'raw',
        rawValue: {
          type: 'init',
          session_id: 'thread-42'
        }
      }
    })

    expect(events.slice(1).map((event) => event.type)).toEqual([
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'complete'
    ])
    expect(events[1].chunk.type).toBe('start-step')
    expect(events[2].chunk.type).toBe('text-start')
    expect(events[3].chunk.type).toBe('text-delta')
    expect(events[4].chunk.type).toBe('text-end')
    expect(events[5].chunk.type).toBe('finish-step')
    expect(events[6].chunk.type).toBe('finish')
  })
})
