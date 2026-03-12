import { loggerService } from '@logger'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import { createSemanticSessionSnapshotV2, type SemanticBlock, type SemanticMessage } from '@shared/agents/semantics'
import type { AgentPersistedMessage } from '@types'

const logger = loggerService.withContext('SnapshotProvider')

function toTimestamp(value: string | undefined, fallback = Date.now()): number {
  if (!value) {
    return fallback
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function normalizeMessageStatus(status: string | undefined): SemanticMessage['status'] {
  switch (status) {
    case 'pending':
    case 'processing':
    case 'streaming':
    case 'success':
    case 'error':
    case 'paused':
      return status
    case 'searching':
      return 'processing'
    default:
      return 'success'
  }
}

function normalizeRole(role: string | undefined): SemanticMessage['role'] {
  switch (role) {
    case 'assistant':
    case 'system':
    case 'tool':
    case 'user':
      return role
    default:
      return 'assistant'
  }
}

function normalizeError(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (typeof record.message !== 'string') {
    return undefined
  }

  return {
    code: typeof record.code === 'string' ? record.code : 'PROVIDER_STREAM_FAILED',
    message: record.message,
    retryable: typeof record.retryable === 'boolean' ? record.retryable : true
  }
}

function normalizeMetadata(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined
}

export class SnapshotProvider {
  async getSessionSnapshot(sessionId: string, snapshotSeqCeiling = 0) {
    try {
      const history = await agentMessageRepository.getSessionHistory(sessionId)
      const messages: SemanticMessage[] = []
      const blocks: SemanticBlock[] = []

      history.forEach((entry) => {
        const message = entry?.message
        if (!message) {
          return
        }

        const createdAt = toTimestamp(message.createdAt)
        const updatedAt = toTimestamp(message.updatedAt ?? message.createdAt, createdAt)
        const normalizedBlocks = this.normalizeBlocks(entry?.blocks, message.id, createdAt)

        messages.push({
          messageId: message.id,
          sessionId,
          runId: typeof message.traceId === 'string' ? message.traceId : undefined,
          role: normalizeRole(message.role),
          status: normalizeMessageStatus(message.status),
          createdAt,
          updatedAt,
          blockIds: normalizedBlocks.map((block) => block.blockId),
          metadata: undefined,
          error: normalizeError((message as Record<string, unknown>).error)
        })

        blocks.push(...normalizedBlocks.map((block, index) => ({ ...block, order: index })))
      })

      const updatedAt = Math.max(
        0,
        ...messages.map((message) => message.updatedAt),
        ...blocks.map((block) => block.updatedAt)
      )

      return createSemanticSessionSnapshotV2(
        {
          sessionId,
          version: updatedAt || messages.length + blocks.length,
          updatedAt: updatedAt || Date.now(),
          messages,
          blocks
        },
        snapshotSeqCeiling
      )
    } catch (error) {
      logger.error('Failed to build session snapshot', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private normalizeBlocks(
    blocks: AgentPersistedMessage['blocks'] | undefined,
    messageId: string,
    messageCreatedAt: number
  ): SemanticBlock[] {
    if (!Array.isArray(blocks)) {
      return []
    }

    return blocks.flatMap((block, index) => {
      if (!block || typeof block === 'string') {
        return []
      }

      const createdAt = toTimestamp(block.createdAt, messageCreatedAt)
      const updatedAt = toTimestamp(block.updatedAt ?? block.createdAt, createdAt)

      return [
        {
          blockId: typeof block.id === 'string' ? block.id : `${messageId}:block:${index}`,
          messageId,
          type: (typeof block.type === 'string' ? block.type : 'unknown') as SemanticBlock['type'],
          status: (typeof block.status === 'string' ? block.status : 'success') as SemanticBlock['status'],
          order: index,
          createdAt,
          updatedAt,
          content: 'content' in block ? block.content : undefined,
          metadata: normalizeMetadata('metadata' in block ? block.metadata : undefined),
          error: normalizeError('error' in block ? block.error : undefined)
        }
      ]
    })
  }
}
