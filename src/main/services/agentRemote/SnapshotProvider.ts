import { loggerService } from '@logger'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { AgentPersistedMessage } from '@types'

const logger = loggerService.withContext('SnapshotProvider')

export interface SessionSnapshotMessage {
  messageId: string
  runId?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  status: 'streaming' | 'done' | 'error'
  updatedAt?: number
}

export interface SessionSnapshot {
  sessionId: string
  snapshotVersion: number
  snapshotSeqCeiling: number
  messages: SessionSnapshotMessage[]
  updatedAt: number
}

export class SnapshotProvider {
  async getSessionSnapshot(sessionId: string, snapshotSeqCeiling = 0): Promise<SessionSnapshot | null> {
    try {
      const history = await agentMessageRepository.getSessionHistory(sessionId)
      const messages = history.map((message, index) => this.toSnapshotMessage(message, index))
      const updatedAt = Date.now()

      return {
        sessionId,
        snapshotVersion: messages.length,
        snapshotSeqCeiling,
        messages,
        updatedAt
      }
    } catch (error) {
      logger.error('Failed to build session snapshot', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private toSnapshotMessage(message: AgentPersistedMessage, index: number): SessionSnapshotMessage {
    const role = this.normalizeRole(message?.message?.role)
    const messageId = message?.message?.id || `${role}-${index + 1}`

    return {
      messageId,
      role,
      content: this.extractContent(message),
      status: 'done'
    }
  }

  private normalizeRole(role: string | undefined): SessionSnapshotMessage['role'] {
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

  private extractContent(message: AgentPersistedMessage | undefined): string {
    const blockText = Array.isArray(message?.blocks)
      ? message.blocks
          .map((block) => {
            if (typeof block === 'string') {
              return block
            }

            if (block && typeof block === 'object') {
              if ('text' in block && typeof block.text === 'string') {
                return block.text
              }

              if ('content' in block && typeof block.content === 'string') {
                return block.content
              }
            }

            return ''
          })
          .filter(Boolean)
          .join('\n')
      : ''

    if (blockText) {
      return blockText
    }

    if (message?.message && typeof message.message === 'object') {
      if ('content' in message.message && typeof message.message.content === 'string') {
        return message.message.content
      }
    }

    try {
      return JSON.stringify(message?.message ?? message ?? '')
    } catch {
      return ''
    }
  }
}
