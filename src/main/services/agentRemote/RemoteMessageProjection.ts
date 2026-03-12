import type {
  SemanticBlock,
  SemanticBlockStatus,
  SemanticEvent,
  SemanticMessage,
  SemanticMessageError,
  SemanticMessageStatus
} from '@shared/agents/semantics'
import type { AgentPersistedMessage } from '@types'
import type { TextStreamPart } from 'ai'

type PersistedRemoteMessage = AgentPersistedMessage['message']
type PersistedRemoteBlock = AgentPersistedMessage['blocks'][number]

type ProjectionBuilderOptions = {
  messageId: string
  agentId: string
  sessionId: string
  agentSessionId: string
  runId?: string
  createdAt?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const toIsoString = (value: number | string | undefined): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  return new Date(typeof value === 'number' ? value : Date.now()).toISOString()
}

const toSerializedError = (message: string | undefined) => {
  if (!message) {
    return undefined
  }

  return {
    message
  } as PersistedRemoteBlock['error']
}

const toBlockContentString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined || value === null) {
    return ''
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const asMessageStatus = (value: 'processing' | 'success' | 'error'): PersistedRemoteMessage['status'] => {
  return value as PersistedRemoteMessage['status']
}

const asBlockType = (value: string): PersistedRemoteBlock['type'] => {
  return value as PersistedRemoteBlock['type']
}

const asBlockStatus = (
  value: 'streaming' | 'pending' | 'success' | 'error' | 'processing'
): PersistedRemoteBlock['status'] => {
  return value as PersistedRemoteBlock['status']
}

const asSemanticMessageStatus = (value: PersistedRemoteMessage['status']): SemanticMessageStatus => {
  switch (value) {
    case 'pending':
    case 'processing':
    case 'success':
    case 'error':
    case 'paused':
      return value
    default:
      return 'processing'
  }
}

const asSemanticBlockStatus = (value: PersistedRemoteBlock['status']): SemanticBlockStatus => {
  switch (value) {
    case 'pending':
    case 'processing':
    case 'streaming':
    case 'success':
    case 'error':
    case 'paused':
      return value
    default:
      return 'processing'
  }
}

const parseIsoTimestamp = (value: string): number => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

const getToolErrorMessage = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Error) {
    return value.message
  }

  if (isRecord(value) && typeof value.message === 'string') {
    return value.message
  }

  return toBlockContentString(value)
}

export class RemoteMessageProjectionBuilder {
  private readonly messageId: string
  private readonly agentId: string
  private readonly sessionId: string
  private agentSessionId: string
  private readonly runId?: string
  private readonly createdAt: string
  private updatedAt: string
  private messageStatus: PersistedRemoteMessage['status'] = asMessageStatus('processing')
  private readonly blocksById = new Map<string, PersistedRemoteBlock>()
  private readonly blockOrder: string[] = []
  private started = false

  constructor(options: ProjectionBuilderOptions) {
    this.messageId = options.messageId
    this.agentId = options.agentId
    this.sessionId = options.sessionId
    this.agentSessionId = options.agentSessionId
    this.runId = options.runId
    this.createdAt = toIsoString(options.createdAt)
    this.updatedAt = this.createdAt
  }

  startStreaming(updatedAtMs = Date.now()): SemanticEvent[] {
    if (this.started) {
      return []
    }

    this.started = true
    const updatedAt = toIsoString(updatedAtMs)
    this.updatedAt = updatedAt
    this.messageStatus = asMessageStatus('processing')

    return [
      {
        event: 'message.started',
        payload: {
          sessionId: this.sessionId,
          runId: this.runId,
          messageId: this.messageId,
          role: 'assistant',
          status: 'processing',
          createdAt: parseIsoTimestamp(this.createdAt),
          updatedAt: parseIsoTimestamp(updatedAt)
        }
      }
    ]
  }

  applyPart(part: TextStreamPart<Record<string, any>>, updatedAtMs = Date.now()): SemanticEvent[] {
    const updatedAt = toIsoString(updatedAtMs)
    this.updatedAt = updatedAt

    switch (part.type) {
      case 'text-start':
        return this.emitBlockAdded(this.ensureMainTextBlock(part.id, updatedAt))

      case 'text-delta':
        if (!part.text) {
          return []
        }
        this.appendMainTextDelta(part.id, part.text, updatedAt)
        return [this.createBlockUpdatedEvent(part.id, updatedAt)]

      case 'text-end':
        return this.updateBlockStatus(part.id, 'success', updatedAt)
          ? [this.createBlockCompletedEvent(part.id, updatedAt)]
          : []

      case 'reasoning-start':
        return this.emitBlockAdded(this.ensureThinkingBlock(part.id, updatedAt))

      case 'reasoning-delta':
        if (!part.text) {
          return []
        }
        this.appendThinkingDelta(part.id, part.text, updatedAt)
        return [this.createBlockUpdatedEvent(part.id, updatedAt)]

      case 'reasoning-end':
        return this.updateBlockStatus(part.id, 'success', updatedAt)
          ? [this.createBlockCompletedEvent(part.id, updatedAt)]
          : []

      case 'tool-input-start':
        return this.emitBlockAdded(
          this.ensureToolBlock(part.id, part.toolName, updatedAt, {
            providerExecuted: part.providerExecuted
          })
        )

      case 'tool-input-delta':
        if (!part.delta) {
          return []
        }
        this.appendToolInputDelta(part.id, part.delta, updatedAt)
        return [this.createBlockUpdatedEvent(part.id, updatedAt)]

      case 'tool-input-end':
        return this.promoteToolBlock(part.id, updatedAt) ? [this.createBlockUpdatedEvent(part.id, updatedAt)] : []

      case 'tool-call':
        this.ensureToolBlock(part.toolCallId, part.toolName, updatedAt, {
          providerExecuted: part.providerExecuted,
          input: part.input
        })
        return this.promoteToolBlock(part.toolCallId, updatedAt, part.input)
          ? [this.createBlockUpdatedEvent(part.toolCallId, updatedAt)]
          : []

      case 'tool-result':
        this.ensureToolBlock(part.toolCallId, undefined, updatedAt, {
          input: part.input
        })
        if (
          !this.completeToolBlock(part.toolCallId, updatedAt, {
            content: part.output,
            status: 'success'
          })
        ) {
          return []
        }
        return [
          this.createBlockUpdatedEvent(part.toolCallId, updatedAt),
          this.createBlockCompletedEvent(part.toolCallId, updatedAt)
        ]

      case 'tool-error':
        this.ensureToolBlock(part.toolCallId, undefined, updatedAt, {
          input: part.input
        })
        const errorMessage = getToolErrorMessage(part.error)
        if (
          !this.completeToolBlock(part.toolCallId, updatedAt, {
            content: errorMessage,
            status: 'error',
            errorMessage
          })
        ) {
          return []
        }
        return [
          this.createBlockUpdatedEvent(part.toolCallId, updatedAt),
          this.createBlockCompletedEvent(part.toolCallId, updatedAt)
        ]

      case 'finish-step':
        return this.finalizeOpenBlocks(updatedAt, 'success')

      case 'finish':
        return this.finalize('success', {
          updatedAt
        })

      default:
        return []
    }
  }

  finalize(
    status: 'success' | 'error',
    options: {
      updatedAt?: number | string
      errorMessage?: string
    } = {}
  ): SemanticEvent[] {
    const updatedAt = toIsoString(options.updatedAt)
    this.updatedAt = updatedAt
    this.messageStatus = asMessageStatus(status)
    const events = this.finalizeOpenBlocks(updatedAt, status)

    if (status === 'error' && options.errorMessage) {
      const errorBlock = this.ensureErrorBlock(updatedAt, options.errorMessage)
      events.push(...this.emitBlockAdded(errorBlock))
      events.push(this.createBlockCompletedEvent(errorBlock.id, updatedAt))
    }

    if (status === 'error') {
      events.push({
        event: 'message.failed',
        payload: {
          sessionId: this.sessionId,
          runId: this.runId,
          messageId: this.messageId,
          status: 'error',
          code: 'PROVIDER_STREAM_FAILED',
          message: options.errorMessage ?? 'Provider stream failed',
          retryable: true,
          updatedAt: parseIsoTimestamp(updatedAt)
        }
      })
      return events
    }

    events.push({
      event: 'message.completed',
      payload: {
        sessionId: this.sessionId,
        runId: this.runId,
        messageId: this.messageId,
        status: 'success',
        updatedAt: parseIsoTimestamp(updatedAt)
      }
    })
    return events
  }

  toPersistedMessage(): AgentPersistedMessage {
    const blocks = this.blockOrder
      .map((blockId) => this.blocksById.get(blockId))
      .filter((block): block is PersistedRemoteBlock => !!block)

    const message: PersistedRemoteMessage = {
      id: this.messageId,
      role: 'assistant',
      assistantId: this.agentId,
      topicId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      status: this.messageStatus,
      blocks: blocks.map((block) => block.id),
      agentSessionId: this.agentSessionId,
      content: this.extractPrimaryContent(blocks),
      traceId: this.runId
    } as PersistedRemoteMessage

    return {
      message,
      blocks
    }
  }

  getUpdatedAtMs(): number {
    const parsed = Date.parse(this.updatedAt)
    return Number.isFinite(parsed) ? parsed : Date.now()
  }

  setAgentSessionId(agentSessionId: string): void {
    if (!agentSessionId || agentSessionId === this.agentSessionId) {
      return
    }

    this.agentSessionId = agentSessionId
  }

  private ensureMainTextBlock(blockId: string, updatedAt: string): PersistedRemoteBlock {
    return this.ensureBlock(
      blockId,
      () =>
        ({
          id: blockId,
          messageId: this.messageId,
          type: asBlockType('main_text'),
          content: '',
          createdAt: updatedAt,
          updatedAt,
          status: asBlockStatus('streaming')
        }) as PersistedRemoteBlock
    )
  }

  private appendMainTextDelta(blockId: string, delta: string, updatedAt: string): void {
    const block = this.ensureMainTextBlock(blockId, updatedAt) as PersistedRemoteBlock & {
      content?: string
    }

    block.content = `${typeof block.content === 'string' ? block.content : ''}${delta}`
    block.updatedAt = updatedAt
    block.status = asBlockStatus('streaming')
  }

  private ensureThinkingBlock(blockId: string, updatedAt: string): PersistedRemoteBlock {
    return this.ensureBlock(
      blockId,
      () =>
        ({
          id: blockId,
          messageId: this.messageId,
          type: asBlockType('thinking'),
          content: '',
          thinking_millsec: 0,
          createdAt: updatedAt,
          updatedAt,
          status: asBlockStatus('streaming')
        }) as PersistedRemoteBlock
    )
  }

  private appendThinkingDelta(blockId: string, delta: string, updatedAt: string): void {
    const block = this.ensureThinkingBlock(blockId, updatedAt) as PersistedRemoteBlock & {
      content?: string
      thinking_millsec?: number
    }

    block.content = `${typeof block.content === 'string' ? block.content : ''}${delta}`
    block.updatedAt = updatedAt
    block.status = asBlockStatus('streaming')
    block.thinking_millsec = 0
  }

  private ensureToolBlock(
    blockId: string,
    toolName: string | undefined,
    updatedAt: string,
    options: {
      providerExecuted?: boolean
      input?: unknown
    } = {}
  ): PersistedRemoteBlock {
    const block = this.ensureBlock(
      blockId,
      () =>
        ({
          id: blockId,
          messageId: this.messageId,
          type: asBlockType('tool'),
          toolId: blockId,
          toolName,
          arguments: isRecord(options.input) ? options.input : undefined,
          createdAt: updatedAt,
          updatedAt,
          status: asBlockStatus('streaming'),
          metadata: options.providerExecuted ? { providerExecuted: true } : undefined
        }) as PersistedRemoteBlock
    ) as PersistedRemoteBlock & {
      toolName?: string
      metadata?: Record<string, unknown>
      arguments?: Record<string, unknown> | string
    }

    block.updatedAt = updatedAt
    block.status =
      block.status === asBlockStatus('success') || block.status === asBlockStatus('error')
        ? block.status
        : asBlockStatus('streaming')

    if (toolName && !block.toolName) {
      block.toolName = toolName
    }

    if (options.providerExecuted) {
      block.metadata = {
        ...(isRecord(block.metadata) ? block.metadata : {}),
        providerExecuted: true
      }
    }

    if (options.input !== undefined) {
      block.arguments = isRecord(options.input) ? options.input : toBlockContentString(options.input)
    }

    return block
  }

  private appendToolInputDelta(blockId: string, delta: string, updatedAt: string): void {
    const block = this.ensureToolBlock(blockId, undefined, updatedAt) as PersistedRemoteBlock & {
      metadata?: Record<string, unknown>
    }

    const current = typeof block.metadata?.partialArguments === 'string' ? block.metadata.partialArguments : ''
    block.metadata = {
      ...(isRecord(block.metadata) ? block.metadata : {}),
      partialArguments: `${current}${delta}`
    }
    block.updatedAt = updatedAt
    block.status = asBlockStatus('streaming')
  }

  private promoteToolBlock(blockId: string, updatedAt: string, input?: unknown): boolean {
    const block = this.ensureToolBlock(blockId, undefined, updatedAt, {
      input
    }) as PersistedRemoteBlock & {
      metadata?: Record<string, unknown>
      arguments?: Record<string, unknown> | string
    }

    const partialArguments = typeof block.metadata?.partialArguments === 'string' ? block.metadata.partialArguments : ''
    if (partialArguments && block.arguments === undefined) {
      block.arguments = this.parseToolArguments(partialArguments)
    }

    block.updatedAt = updatedAt
    block.status = asBlockStatus('pending')
    return true
  }

  private completeToolBlock(
    blockId: string,
    updatedAt: string,
    options: {
      content: unknown
      status: 'success' | 'error'
      errorMessage?: string
    }
  ): boolean {
    const block = this.ensureToolBlock(blockId, undefined, updatedAt) as PersistedRemoteBlock & {
      content?: string | object
    }

    block.updatedAt = updatedAt
    block.status = asBlockStatus(options.status)
    block.content = isRecord(options.content) ? options.content : toBlockContentString(options.content)
    block.error = toSerializedError(options.errorMessage)
    return true
  }

  private ensureErrorBlock(updatedAt: string, errorMessage: string): PersistedRemoteBlock {
    const errorBlockId = `${this.messageId}:error`
    const block = this.ensureBlock(
      errorBlockId,
      () =>
        ({
          id: errorBlockId,
          messageId: this.messageId,
          type: asBlockType('error'),
          createdAt: updatedAt,
          updatedAt,
          status: asBlockStatus('error'),
          error: toSerializedError(errorMessage)
        }) as PersistedRemoteBlock
    )

    block.updatedAt = updatedAt
    block.status = asBlockStatus('error')
    block.error = toSerializedError(errorMessage)
    return block
  }

  private updateBlockStatus(blockId: string, status: 'success' | 'pending' | 'streaming' | 'error', updatedAt: string) {
    const block = this.blocksById.get(blockId)
    if (!block) {
      return false
    }

    block.updatedAt = updatedAt
    block.status = asBlockStatus(status)
    return true
  }

  private finalizeOpenBlocks(updatedAt: string, status: 'success' | 'error'): SemanticEvent[] {
    const events: SemanticEvent[] = []
    for (const blockId of this.blockOrder) {
      const block = this.blocksById.get(blockId)
      if (!block) {
        continue
      }

      if (block.status === 'streaming' || block.status === 'pending' || block.status === 'processing') {
        block.status = asBlockStatus(status)
        block.updatedAt = updatedAt
        events.push(this.createBlockCompletedEvent(blockId, updatedAt))
      }
    }
    return events
  }

  private ensureBlock(blockId: string, factory: () => PersistedRemoteBlock): PersistedRemoteBlock {
    const existing = this.blocksById.get(blockId)
    if (existing) {
      return existing
    }

    const block = factory()
    this.blocksById.set(blockId, block)
    this.blockOrder.push(blockId)
    return block
  }

  private extractPrimaryContent(blocks: PersistedRemoteBlock[]): string {
    const textContent = blocks
      .filter((block) => block.type === 'main_text' && typeof (block as { content?: unknown }).content === 'string')
      .map((block) => (block as { content: string }).content)
      .join('\n\n')

    if (textContent) {
      return textContent
    }

    const fallbackText = blocks
      .map((block) => {
        if ('content' in block && typeof block.content === 'string') {
          return block.content
        }

        if ('error' in block && isRecord(block.error) && typeof block.error.message === 'string') {
          return block.error.message
        }

        return ''
      })
      .filter(Boolean)
      .join('\n\n')

    return fallbackText
  }

  private parseToolArguments(value: string): Record<string, unknown> | string {
    try {
      const parsed = JSON.parse(value)
      return isRecord(parsed) ? parsed : value
    } catch {
      return value
    }
  }

  private emitBlockAdded(block: PersistedRemoteBlock): SemanticEvent[] {
    return [
      {
        event: 'message.block.added',
        payload: {
          sessionId: this.sessionId,
          runId: this.runId,
          messageId: this.messageId,
          block: this.toSemanticBlock(block)
        }
      }
    ]
  }

  private createBlockUpdatedEvent(blockId: string, updatedAt: string): SemanticEvent {
    const block = this.blocksById.get(blockId)
    if (!block) {
      throw new Error(`Cannot create block update for missing block ${blockId}`)
    }

    return {
      event: 'message.block.updated',
      payload: {
        sessionId: this.sessionId,
        runId: this.runId,
        messageId: this.messageId,
        blockId,
        patch: this.toSemanticBlockPatch(block),
        updatedAt: parseIsoTimestamp(updatedAt)
      }
    }
  }

  private createBlockCompletedEvent(blockId: string, updatedAt: string): SemanticEvent {
    const block = this.blocksById.get(blockId)
    if (!block) {
      throw new Error(`Cannot create block completion for missing block ${blockId}`)
    }

    return {
      event: 'message.block.completed',
      payload: {
        sessionId: this.sessionId,
        runId: this.runId,
        messageId: this.messageId,
        blockId,
        status: block.status === 'error' ? 'error' : block.status === 'paused' ? 'paused' : 'success',
        updatedAt: parseIsoTimestamp(updatedAt)
      }
    }
  }

  private toSemanticBlock(block: PersistedRemoteBlock): SemanticBlock {
    return {
      blockId: block.id,
      messageId: this.messageId,
      type: (block.type ?? 'unknown') as SemanticBlock['type'],
      status: asSemanticBlockStatus(block.status),
      order: this.blockOrder.indexOf(block.id),
      createdAt: parseIsoTimestamp(block.createdAt),
      updatedAt: parseIsoTimestamp(block.updatedAt ?? block.createdAt),
      content: 'content' in block ? block.content : undefined,
      metadata: isRecord(block.metadata) ? (block.metadata as Record<string, any>) : undefined,
      error: this.toSemanticError(block.error)
    }
  }

  private toSemanticBlockPatch(block: PersistedRemoteBlock): {
    type?: SemanticBlock['type']
    status?: SemanticBlockStatus
    order?: number
    content?: unknown
    metadata?: Record<string, any>
    error?: SemanticMessageError
  } {
    return {
      type: (block.type ?? 'unknown') as SemanticBlock['type'],
      status: asSemanticBlockStatus(block.status),
      order: this.blockOrder.indexOf(block.id),
      content: 'content' in block ? block.content : undefined,
      metadata: isRecord(block.metadata) ? (block.metadata as Record<string, any>) : undefined,
      error: this.toSemanticError(block.error)
    }
  }

  private toSemanticMessage(): SemanticMessage {
    return {
      messageId: this.messageId,
      sessionId: this.sessionId,
      runId: this.runId,
      role: 'assistant',
      status: asSemanticMessageStatus(this.messageStatus),
      createdAt: parseIsoTimestamp(this.createdAt),
      updatedAt: parseIsoTimestamp(this.updatedAt),
      blockIds: [...this.blockOrder]
    }
  }

  toSemanticSnapshotState(): { message: SemanticMessage; blocks: SemanticBlock[] } {
    return {
      message: this.toSemanticMessage(),
      blocks: this.blockOrder
        .map((blockId) => this.blocksById.get(blockId))
        .filter((block): block is PersistedRemoteBlock => !!block)
        .map((block) => this.toSemanticBlock(block))
    }
  }

  private toSemanticError(value: unknown): SemanticMessageError | undefined {
    if (!isRecord(value) || typeof value.message !== 'string') {
      return undefined
    }

    return {
      code: typeof value.code === 'string' ? value.code : 'PROVIDER_STREAM_FAILED',
      message: value.message,
      retryable: typeof value.retryable === 'boolean' ? value.retryable : true
    }
  }
}
