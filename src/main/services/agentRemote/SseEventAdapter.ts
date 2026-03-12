import { loggerService } from '@logger'
import type { SemanticEvent } from '@shared/agents/semantics'

import { createRemoteEventEnvelope, type RemoteEnvelope } from './types'

const logger = loggerService.withContext('SseEventAdapter')

interface AdaptSemanticContext {
  requestId?: string
  runId?: string
}

export class SseEventAdapter {
  adaptEvent(event: SemanticEvent, context: AdaptSemanticContext): RemoteEnvelope {
    const eventRunId =
      'runId' in event.payload && typeof event.payload.runId === 'string' ? event.payload.runId : undefined
    return createRemoteEventEnvelope(event.event, event.payload, {
      requestId: context.requestId,
      runId: context.runId ?? eventRunId
    })
  }

  adaptEvents(events: SemanticEvent[], context: AdaptSemanticContext): RemoteEnvelope[] {
    try {
      return events.map((event) => this.adaptEvent(event, context))
    } catch (error) {
      logger.error('Failed to adapt semantic events into remote envelopes', {
        error: error instanceof Error ? error.message : String(error),
        requestId: context.requestId,
        runId: context.runId
      })
      throw error
    }
  }
}
