import { loggerService } from '@logger'
import type { TextStreamPart } from 'ai'

import { createRemoteEventEnvelope, type RemoteEnvelope } from './types'

const logger = loggerService.withContext('SseEventAdapter')

interface AdaptStreamContext {
  sessionId: string
  requestId?: string
  runId: string
  messageId: string
  version?: number
  updatedAt?: number
}

export class SseEventAdapter {
  async *adaptStream(
    stream: ReadableStream<TextStreamPart<Record<string, any>>>,
    context: AdaptStreamContext
  ): AsyncGenerator<RemoteEnvelope> {
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        if (value?.type !== 'text-delta' || !value.text) {
          continue
        }

        yield createRemoteEventEnvelope(
          'message.delta',
          {
            sessionId: context.sessionId,
            runId: context.runId,
            messageId: context.messageId,
            role: 'assistant',
            delta: value.text,
            version: context.version,
            updatedAt: context.updatedAt ?? Date.now()
          },
          {
            requestId: context.requestId,
            runId: context.runId
          }
        )
      }
    } catch (error) {
      logger.error('Failed to adapt text stream into remote events', {
        error: error instanceof Error ? error.message : String(error),
        runId: context.runId,
        sessionId: context.sessionId
      })
      throw error
    } finally {
      reader.releaseLock()
    }
  }
}
