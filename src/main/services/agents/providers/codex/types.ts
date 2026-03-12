import type { LanguageModelUsage } from 'ai'

export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

export interface CodexTurnErrorInfo {
  type?: string
  code?: string
}

export interface CodexTurnError {
  message: string
  codexErrorInfo?: CodexTurnErrorInfo | null
  additionalDetails?: string | null
}

export interface CodexTurn {
  id: string
  items: CodexThreadItem[]
  status: CodexTurnStatus
  error?: CodexTurnError | null
}

export interface CodexUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export interface CodexThreadTokenUsage {
  total: CodexUsageBreakdown
  last: CodexUsageBreakdown
  modelContextWindow?: number | null
}

export type CodexMessagePhase = 'thought' | 'action' | 'output' | (string & {})

export type CodexThreadItem =
  | {
      type: 'userMessage'
      id: string
      content: unknown[]
    }
  | {
      type: 'agentMessage'
      id: string
      text: string
      phase?: CodexMessagePhase | null
    }
  | {
      type: 'plan'
      id: string
      text: string
    }
  | {
      type: 'reasoning'
      id: string
      summary: string[]
      content: string[]
    }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd: string
      processId?: string | null
      status: string
      commandActions?: unknown[]
      aggregatedOutput?: string | null
      exitCode?: number | null
      durationMs?: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: unknown[]
      status: string
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: string
      arguments: unknown
      result?: unknown
      error?: unknown
      durationMs?: number | null
    }
  | {
      type: 'dynamicToolCall'
      id: string
      tool: string
      arguments: unknown
      status: string
      contentItems?: unknown[] | null
      success?: boolean | null
      durationMs?: number | null
    }
  | {
      type: 'collabAgentToolCall'
      id: string
      tool: string
      status: string
      senderThreadId: string
      receiverThreadIds: string[]
      prompt?: string | null
      agentsStates?: Record<string, unknown>
    }
  | {
      type: 'webSearch'
      id: string
      query: string
      status?: string
      action?: unknown
    }
  | {
      type: 'imageView'
      id: string
      path: string
      status?: string
    }
  | {
      type: 'imageGeneration'
      id: string
      status: string
      revisedPrompt?: string | null
      result: string
    }
  | {
      type: 'enteredReviewMode'
      id: string
      review: string
    }
  | {
      type: 'exitedReviewMode'
      id: string
      review: string
    }
  | {
      type: 'contextCompaction'
      id: string
    }

export type CodexAppServerEvent =
  | {
      type: 'turn.started'
      threadId: string
      turn: CodexTurn
    }
  | {
      type: 'turn.completed'
      threadId: string
      turn: CodexTurn
    }
  | {
      type: 'item.started'
      threadId: string
      turnId: string
      item: CodexThreadItem
    }
  | {
      type: 'item.completed'
      threadId: string
      turnId: string
      item: CodexThreadItem
    }
  | {
      type: 'agent.message.delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | {
      type: 'plan.delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
    }
  | {
      type: 'reasoning.summary.delta'
      threadId: string
      turnId: string
      itemId: string
      delta: string
      summaryIndex: number
    }
  | {
      type: 'thread.token.usage.updated'
      threadId: string
      turnId: string
      tokenUsage: CodexThreadTokenUsage
    }
  | {
      type: 'error'
      threadId: string
      turnId: string
      error: CodexTurnError
      willRetry: boolean
    }

export function codexUsageToLanguageModelUsage(usage?: CodexUsageBreakdown | null): LanguageModelUsage | undefined {
  if (!usage) {
    return undefined
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    inputTokenDetails: {
      cacheReadTokens: usage.cachedInputTokens,
      cacheWriteTokens: 0,
      noCacheTokens: Math.max(usage.inputTokens - usage.cachedInputTokens, 0)
    },
    outputTokenDetails: {
      textTokens: Math.max(usage.outputTokens - usage.reasoningOutputTokens, 0),
      reasoningTokens: usage.reasoningOutputTokens
    }
  }
}
