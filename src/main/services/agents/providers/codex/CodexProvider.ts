import { EventEmitter } from 'node:events'

import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '../../interfaces/AgentStreamInterface'
import { CodexAppServerClient } from './CodexAppServerClient'
import { CodexAppServerEventAdapter } from './CodexAppServerEventAdapter'
import type { CodexAppServerEvent } from './types'

class CodexProviderStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
}

const isAbortError = (value: unknown): value is Error => {
  return value instanceof Error && value.name === 'AbortError'
}

const toAsyncIterable = async function* <T>(iterable: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in iterable) {
    yield* iterable as AsyncIterable<T>
    return
  }

  yield* iterable as Iterable<T>
}

export class CodexProvider implements AgentServiceInterface {
  private readonly adapter = new CodexAppServerEventAdapter()

  constructor(private readonly client = new CodexAppServerClient()) {}

  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string,
    thinkingOptions?: AgentThinkingOptions
  ): Promise<AgentStream> {
    const stream = new CodexProviderStream()

    const cwd = session.accessible_paths[0]
    if (!cwd) {
      setImmediate(() => {
        stream.emit('data', {
          type: 'error',
          error: new Error('No accessible paths defined for the Codex session')
        })
      })
      return stream
    }

    try {
      const execution = await this.client.runTurn({
        prompt,
        session,
        lastThreadId: lastAgentSessionId,
        thinkingOptions,
        signal: abortController.signal
      })

      setImmediate(() => {
        stream.emit('data', {
          type: 'chunk',
          chunk: {
            type: 'raw',
            rawValue: {
              type: 'init',
              session_id: execution.threadId
            }
          } as TextStreamPart<Record<string, any>>
        })
        void this.pumpEvents(execution.events, stream)
      })

      return stream
    } catch (error) {
      setImmediate(() => {
        if (isAbortError(error)) {
          stream.emit('data', {
            type: 'cancelled'
          })
          return
        }

        stream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        })
      })
      return stream
    }
  }

  createStreamFromEvents(events: AsyncIterable<CodexAppServerEvent> | Iterable<CodexAppServerEvent>): AgentStream {
    const stream = new CodexProviderStream()

    setImmediate(() => {
      void this.pumpEvents(events, stream)
    })

    return stream
  }

  private async pumpEvents(
    events: AsyncIterable<CodexAppServerEvent> | Iterable<CodexAppServerEvent>,
    stream: CodexProviderStream
  ): Promise<void> {
    try {
      for await (const event of toAsyncIterable(events)) {
        const chunks = this.adapter.adapt(event)
        for (const chunk of chunks) {
          stream.emit('data', {
            type: 'chunk',
            chunk: chunk as TextStreamPart<Record<string, any>>
          })
        }

        if (event.type === 'turn.completed') {
          if (this.adapter.didTurnFail(event)) {
            stream.emit('data', {
              type: 'error',
              error: new Error(event.turn.error?.message ?? 'Codex turn failed')
            })
            return
          }

          if (event.turn.status === 'interrupted') {
            stream.emit('data', {
              type: 'cancelled'
            })
            return
          }
        }
      }

      stream.emit('data', {
        type: 'complete'
      })
    } catch (error) {
      if (isAbortError(error)) {
        stream.emit('data', {
          type: 'cancelled'
        })
        return
      }

      stream.emit('data', {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }
}
