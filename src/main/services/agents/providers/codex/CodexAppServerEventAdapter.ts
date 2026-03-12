import { loggerService } from '@logger'
import type { LanguageModelUsage, ProviderMetadata, TextStreamPart } from 'ai'

import {
  type CodexAppServerEvent,
  type CodexThreadItem,
  type CodexTurnStatus,
  codexUsageToLanguageModelUsage
} from './types'

const logger = loggerService.withContext('CodexAppServerEventAdapter')

type AgentStreamPart = TextStreamPart<Record<string, any>>

type ToolLikeItem = Extract<
  CodexThreadItem,
  { type: 'commandExecution' | 'mcpToolCall' | 'dynamicToolCall' | 'webSearch' | 'imageView' | 'imageGeneration' }
>

type CodexAdapterState = {
  stepStarted: boolean
  currentTurnId?: string
  usage?: LanguageModelUsage
  openTextItemIds: Set<string>
  openReasoningItemIds: Set<string>
  emittedToolLifecycleIds: Set<string>
  seenTextDeltaIds: Set<string>
  seenReasoningDeltaIds: Set<string>
}

const createInitialState = (): CodexAdapterState => ({
  stepStarted: false,
  openTextItemIds: new Set<string>(),
  openReasoningItemIds: new Set<string>(),
  emittedToolLifecycleIds: new Set<string>(),
  seenTextDeltaIds: new Set<string>(),
  seenReasoningDeltaIds: new Set<string>()
})

const emptyUsage: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    noCacheTokens: 0
  },
  outputTokenDetails: {
    textTokens: 0,
    reasoningTokens: 0
  }
}

const isToolLikeItem = (item: CodexThreadItem): item is ToolLikeItem => {
  return (
    item.type === 'commandExecution' ||
    item.type === 'mcpToolCall' ||
    item.type === 'dynamicToolCall' ||
    item.type === 'webSearch' ||
    item.type === 'imageView' ||
    item.type === 'imageGeneration'
  )
}

const isTerminalToolError = (item: ToolLikeItem): boolean => {
  switch (item.type) {
    case 'commandExecution':
      return /fail|error|reject|deny/i.test(item.status)
    case 'mcpToolCall':
      return !!item.error || /fail|error/i.test(item.status)
    case 'dynamicToolCall':
      return item.success === false || /fail|error/i.test(item.status)
    case 'webSearch':
    case 'imageView':
    case 'imageGeneration':
      return /fail|error/i.test(item.status ?? '')
    default:
      return false
  }
}

const isSuccessfulTurnStatus = (status: CodexTurnStatus): boolean => {
  return status === 'completed' || status === 'interrupted'
}

const toFinishReason = (status: CodexTurnStatus): 'stop' | 'error' => {
  return status === 'failed' ? 'error' : 'stop'
}

const serializeToolInput = (item: ToolLikeItem): unknown => {
  switch (item.type) {
    case 'commandExecution':
      return {
        command: item.command,
        cwd: item.cwd,
        commandActions: item.commandActions,
        processId: item.processId
      }
    case 'mcpToolCall':
      return {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments
      }
    case 'dynamicToolCall':
      return {
        tool: item.tool,
        arguments: item.arguments
      }
    case 'webSearch':
      return {
        query: item.query,
        action: item.action
      }
    case 'imageView':
      return {
        path: item.path
      }
    case 'imageGeneration':
      return {
        revisedPrompt: item.revisedPrompt
      }
    default:
      return {}
  }
}

const serializeToolOutput = (item: ToolLikeItem): unknown => {
  switch (item.type) {
    case 'commandExecution':
      return {
        status: item.status,
        aggregatedOutput: item.aggregatedOutput,
        exitCode: item.exitCode,
        durationMs: item.durationMs
      }
    case 'mcpToolCall':
      return {
        status: item.status,
        result: item.result,
        error: item.error,
        durationMs: item.durationMs
      }
    case 'dynamicToolCall':
      return {
        status: item.status,
        contentItems: item.contentItems,
        success: item.success,
        durationMs: item.durationMs
      }
    case 'webSearch':
      return {
        query: item.query,
        action: item.action,
        status: item.status
      }
    case 'imageView':
      return {
        path: item.path,
        status: item.status
      }
    case 'imageGeneration':
      return {
        status: item.status,
        revisedPrompt: item.revisedPrompt,
        result: item.result
      }
    default:
      return {}
  }
}

const toToolName = (item: ToolLikeItem): string => {
  switch (item.type) {
    case 'commandExecution':
      return 'command_execution'
    case 'mcpToolCall':
      return item.tool
    case 'dynamicToolCall':
      return item.tool
    case 'webSearch':
      return 'web_search'
    case 'imageView':
      return 'image_view'
    case 'imageGeneration':
      return 'image_generation'
    default:
      return 'codex_tool'
  }
}

const toMetadata = (
  event: CodexAppServerEvent,
  extra: Record<string, unknown> = {},
  rawOverride?: Record<string, unknown>
): ProviderMetadata => {
  const base = {
    eventType: event.type,
    threadId: event.threadId,
    ...('turnId' in event ? { turnId: event.turnId } : {}),
    ...extra
  }

  return {
    codex: {
      ...base,
      ...(rawOverride ? { raw: rawOverride } : {})
    } as Record<string, any>
  } as ProviderMetadata
}

export class CodexAppServerEventAdapter {
  private readonly state: CodexAdapterState

  constructor() {
    this.state = createInitialState()
  }

  adapt(event: CodexAppServerEvent): AgentStreamPart[] {
    switch (event.type) {
      case 'turn.started':
        return this.handleTurnStarted(event)
      case 'turn.completed':
        return this.handleTurnCompleted(event)
      case 'item.started':
        return this.handleItemStarted(event)
      case 'item.completed':
        return this.handleItemCompleted(event)
      case 'agent.message.delta':
        return this.handleAgentMessageDelta(event)
      case 'plan.delta':
        return this.handlePlanDelta(event)
      case 'reasoning.summary.delta':
        return this.handleReasoningDelta(event)
      case 'thread.token.usage.updated':
        this.state.usage = codexUsageToLanguageModelUsage(event.tokenUsage.last)
        return []
      case 'error':
        logger.warn('Received Codex error notification', {
          threadId: event.threadId,
          turnId: event.turnId,
          message: event.error.message,
          willRetry: event.willRetry
        })
        return []
      default:
        return []
    }
  }

  private handleTurnStarted(event: Extract<CodexAppServerEvent, { type: 'turn.started' }>): AgentStreamPart[] {
    if (this.state.stepStarted && this.state.currentTurnId === event.turn.id) {
      return []
    }

    this.resetOpenItemState()
    this.state.stepStarted = true
    this.state.currentTurnId = event.turn.id

    return [
      {
        type: 'start-step',
        request: { body: '' },
        warnings: []
      }
    ]
  }

  private handleTurnCompleted(event: Extract<CodexAppServerEvent, { type: 'turn.completed' }>): AgentStreamPart[] {
    const chunks: AgentStreamPart[] = []

    if (!this.state.stepStarted) {
      chunks.push(...this.handleTurnStarted({ ...event, type: 'turn.started' }))
    }

    for (const item of event.turn.items) {
      chunks.push(
        ...this.handleItemCompleted({
          type: 'item.completed',
          threadId: event.threadId,
          turnId: event.turn.id,
          item
        })
      )
    }

    for (const itemId of this.state.openTextItemIds) {
      chunks.push({
        type: 'text-end',
        id: itemId,
        providerMetadata: toMetadata(event, {
          itemId
        })
      })
    }

    for (const itemId of this.state.openReasoningItemIds) {
      chunks.push({
        type: 'reasoning-end',
        id: itemId,
        providerMetadata: toMetadata(event, {
          itemId
        })
      })
    }

    chunks.push({
      type: 'finish-step',
      response: {
        id: event.turn.id,
        timestamp: new Date(),
        modelId: 'codex'
      },
      finishReason: toFinishReason(event.turn.status),
      usage: this.state.usage ?? emptyUsage,
      rawFinishReason: event.turn.status,
      providerMetadata: toMetadata(event, {
        turnStatus: event.turn.status,
        error: event.turn.error ?? undefined
      })
    })

    this.state.stepStarted = false
    this.state.currentTurnId = undefined
    this.state.usage = undefined
    this.resetOpenItemState()

    return chunks
  }

  private handleItemStarted(event: Extract<CodexAppServerEvent, { type: 'item.started' }>): AgentStreamPart[] {
    const { item } = event

    switch (item.type) {
      case 'reasoning':
      case 'plan':
        return this.ensureReasoningStarted(item.id, event)
      case 'agentMessage':
        return []
      default:
        if (!isToolLikeItem(item)) {
          return []
        }

        return this.emitToolLifecycle(item, event)
    }
  }

  private handleItemCompleted(event: Extract<CodexAppServerEvent, { type: 'item.completed' }>): AgentStreamPart[] {
    const { item } = event

    switch (item.type) {
      case 'agentMessage':
        return this.completeAgentMessage(item, event)
      case 'reasoning':
        return this.completeReasoningItem(item, event)
      case 'plan':
        return this.completePlanItem(item, event)
      default:
        if (!isToolLikeItem(item)) {
          return []
        }

        const chunks = this.emitToolLifecycle(item, event)
        const providerMetadata = toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })

        if (isTerminalToolError(item)) {
          const output = serializeToolOutput(item)
          return [
            ...chunks,
            {
              type: 'tool-error',
              toolCallId: item.id,
              toolName: toToolName(item),
              input: serializeToolInput(item),
              error: typeof output === 'string' ? output : JSON.stringify(output),
              providerExecuted: true,
              providerMetadata
            }
          ]
        }

        return [
          ...chunks,
          {
            type: 'tool-result',
            toolCallId: item.id,
            toolName: toToolName(item),
            input: serializeToolInput(item),
            output: serializeToolOutput(item),
            providerExecuted: true,
            providerMetadata
          }
        ]
    }
  }

  private handleAgentMessageDelta(
    event: Extract<CodexAppServerEvent, { type: 'agent.message.delta' }>
  ): AgentStreamPart[] {
    const chunks = this.ensureTextStarted(event.itemId, event)
    this.state.seenTextDeltaIds.add(event.itemId)
    chunks.push({
      type: 'text-delta',
      id: event.itemId,
      text: event.delta,
      providerMetadata: toMetadata(event, {
        itemId: event.itemId
      })
    })
    return chunks
  }

  private handlePlanDelta(event: Extract<CodexAppServerEvent, { type: 'plan.delta' }>): AgentStreamPart[] {
    const chunks = this.ensureReasoningStarted(event.itemId, event)
    this.state.seenReasoningDeltaIds.add(event.itemId)
    chunks.push({
      type: 'reasoning-delta',
      id: event.itemId,
      text: event.delta,
      providerMetadata: toMetadata(event, {
        itemId: event.itemId,
        itemType: 'plan'
      })
    })
    return chunks
  }

  private handleReasoningDelta(
    event: Extract<CodexAppServerEvent, { type: 'reasoning.summary.delta' }>
  ): AgentStreamPart[] {
    const chunks = this.ensureReasoningStarted(event.itemId, event)
    this.state.seenReasoningDeltaIds.add(event.itemId)
    chunks.push({
      type: 'reasoning-delta',
      id: event.itemId,
      text: event.delta,
      providerMetadata: toMetadata(event, {
        itemId: event.itemId,
        summaryIndex: event.summaryIndex
      })
    })
    return chunks
  }

  private completeAgentMessage(
    item: Extract<CodexThreadItem, { type: 'agentMessage' }>,
    event: Extract<CodexAppServerEvent, { type: 'item.completed' }>
  ): AgentStreamPart[] {
    const chunks = this.ensureTextStarted(item.id, event)

    if (!this.state.seenTextDeltaIds.has(item.id) && item.text) {
      chunks.push({
        type: 'text-delta',
        id: item.id,
        text: item.text,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type,
          phase: item.phase ?? undefined
        })
      })
    }

    if (this.state.openTextItemIds.has(item.id)) {
      chunks.push({
        type: 'text-end',
        id: item.id,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })
      })
      this.state.openTextItemIds.delete(item.id)
    }

    return chunks
  }

  private completeReasoningItem(
    item: Extract<CodexThreadItem, { type: 'reasoning' }>,
    event: Extract<CodexAppServerEvent, { type: 'item.completed' }>
  ): AgentStreamPart[] {
    const chunks = this.ensureReasoningStarted(item.id, event)
    const content = [...item.summary, ...item.content].join('\n').trim()

    if (!this.state.seenReasoningDeltaIds.has(item.id) && content) {
      chunks.push({
        type: 'reasoning-delta',
        id: item.id,
        text: content,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })
      })
    }

    if (this.state.openReasoningItemIds.has(item.id)) {
      chunks.push({
        type: 'reasoning-end',
        id: item.id,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })
      })
      this.state.openReasoningItemIds.delete(item.id)
    }

    return chunks
  }

  private completePlanItem(
    item: Extract<CodexThreadItem, { type: 'plan' }>,
    event: Extract<CodexAppServerEvent, { type: 'item.completed' }>
  ): AgentStreamPart[] {
    const chunks = this.ensureReasoningStarted(item.id, event)

    if (!this.state.seenReasoningDeltaIds.has(item.id) && item.text) {
      chunks.push({
        type: 'reasoning-delta',
        id: item.id,
        text: item.text,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })
      })
    }

    if (this.state.openReasoningItemIds.has(item.id)) {
      chunks.push({
        type: 'reasoning-end',
        id: item.id,
        providerMetadata: toMetadata(event, {
          itemId: item.id,
          itemType: item.type
        })
      })
      this.state.openReasoningItemIds.delete(item.id)
    }

    return chunks
  }

  private ensureTextStarted(itemId: string, event: CodexAppServerEvent): AgentStreamPart[] {
    if (this.state.openTextItemIds.has(itemId)) {
      return []
    }

    this.state.openTextItemIds.add(itemId)
    return [
      {
        type: 'text-start',
        id: itemId,
        providerMetadata: toMetadata(event, {
          itemId
        })
      }
    ]
  }

  private ensureReasoningStarted(itemId: string, event: CodexAppServerEvent): AgentStreamPart[] {
    if (this.state.openReasoningItemIds.has(itemId)) {
      return []
    }

    this.state.openReasoningItemIds.add(itemId)
    return [
      {
        type: 'reasoning-start',
        id: itemId,
        providerMetadata: toMetadata(event, {
          itemId
        })
      }
    ]
  }

  private emitToolLifecycle(item: ToolLikeItem, event: CodexAppServerEvent): AgentStreamPart[] {
    if (this.state.emittedToolLifecycleIds.has(item.id)) {
      return []
    }

    this.state.emittedToolLifecycleIds.add(item.id)

    const toolName = toToolName(item)
    const input = serializeToolInput(item)
    const serializedInput =
      typeof input === 'string'
        ? input
        : (() => {
            try {
              return JSON.stringify(input)
            } catch {
              return String(input)
            }
          })()
    const providerMetadata = toMetadata(event, {
      itemId: item.id,
      itemType: item.type
    })

    return [
      {
        type: 'tool-input-start',
        id: item.id,
        toolName,
        providerExecuted: true,
        providerMetadata
      },
      {
        type: 'tool-input-delta',
        id: item.id,
        delta: serializedInput,
        providerMetadata
      },
      {
        type: 'tool-input-end',
        id: item.id,
        providerMetadata
      },
      {
        type: 'tool-call',
        toolCallId: item.id,
        toolName,
        input,
        providerExecuted: true,
        providerMetadata
      }
    ]
  }

  private resetOpenItemState(): void {
    this.state.openTextItemIds.clear()
    this.state.openReasoningItemIds.clear()
    this.state.emittedToolLifecycleIds.clear()
    this.state.seenTextDeltaIds.clear()
    this.state.seenReasoningDeltaIds.clear()
  }

  didTurnFail(event: Extract<CodexAppServerEvent, { type: 'turn.completed' }>): boolean {
    return !isSuccessfulTurnStatus(event.turn.status)
  }
}
