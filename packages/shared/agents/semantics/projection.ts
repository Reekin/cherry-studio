import {
  type SemanticBlock,
  semanticBlockSchema,
  type SemanticEvent,
  semanticEventSchema,
  type SemanticMessage,
  semanticMessageSchema,
  type SemanticSessionProjection,
  semanticSessionProjectionSchema,
  type SemanticSessionSnapshotV2,
  semanticSessionSnapshotV2Schema
} from './schemas.js'

type MergeableObject = Record<string, unknown>

function isMergeableObject(value: unknown): value is MergeableObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareMessages(left: SemanticMessage, right: SemanticMessage): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt - right.updatedAt
  }

  return left.messageId.localeCompare(right.messageId)
}

function compareBlocks(left: SemanticBlock, right: SemanticBlock): number {
  if (left.order !== right.order) {
    return left.order - right.order
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt
  }

  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt - right.updatedAt
  }

  return left.blockId.localeCompare(right.blockId)
}

function mergeSemanticJsonValue(existingValue: unknown, patchValue: unknown): unknown {
  if (isMergeableObject(existingValue) && isMergeableObject(patchValue)) {
    const mergedEntries = new Map<string, unknown>()

    for (const [key, value] of Object.entries(existingValue)) {
      mergedEntries.set(key, value)
    }

    for (const [key, value] of Object.entries(patchValue)) {
      const currentValue = mergedEntries.get(key)
      mergedEntries.set(key, mergeSemanticJsonValue(currentValue, value))
    }

    return Object.fromEntries(mergedEntries)
  }

  return patchValue
}

function mergeSemanticJsonObject(
  existingValue: MergeableObject | undefined,
  patchValue: MergeableObject | undefined
): MergeableObject | undefined {
  if (!patchValue) {
    return existingValue
  }

  if (!existingValue) {
    return patchValue
  }

  return mergeSemanticJsonValue(existingValue, patchValue) as MergeableObject
}

function getMessageFallback(sessionId: string, messageId: string, updatedAt: number, runId?: string): SemanticMessage {
  return {
    messageId,
    sessionId,
    runId,
    role: 'assistant',
    status: 'streaming',
    createdAt: updatedAt,
    updatedAt,
    blockIds: []
  }
}

function cloneProjection(projection: SemanticSessionProjection): SemanticSessionProjection {
  return {
    ...projection,
    messages: projection.messages.map((message) =>
      semanticMessageSchema.parse({
        ...message,
        blockIds: [...message.blockIds],
        metadata: isMergeableObject(message.metadata) ? { ...message.metadata } : message.metadata,
        error: message.error ? { ...message.error } : undefined
      })
    ),
    blocks: projection.blocks.map((block) =>
      semanticBlockSchema.parse({
        ...block,
        content: isMergeableObject(block.content) ? { ...block.content } : block.content,
        metadata: isMergeableObject(block.metadata) ? { ...block.metadata } : block.metadata
      })
    )
  }
}

export function normalizeSemanticSessionProjection(projection: SemanticSessionProjection): SemanticSessionProjection {
  const parsedProjection = semanticSessionProjectionSchema.parse(projection)
  const messageMap = new Map<string, SemanticMessage>()
  const blockMap = new Map<string, SemanticBlock>()

  for (const message of parsedProjection.messages) {
    const parsedMessage = semanticMessageSchema.parse(message)
    messageMap.set(parsedMessage.messageId, { ...parsedMessage, blockIds: [...parsedMessage.blockIds] })
  }

  for (const block of parsedProjection.blocks) {
    const parsedBlock = semanticBlockSchema.parse(block)
    blockMap.set(
      parsedBlock.blockId,
      semanticBlockSchema.parse({
        ...parsedBlock,
        content: isMergeableObject(parsedBlock.content) ? { ...parsedBlock.content } : parsedBlock.content,
        metadata: isMergeableObject(parsedBlock.metadata) ? { ...parsedBlock.metadata } : parsedBlock.metadata
      })
    )

    if (!messageMap.has(parsedBlock.messageId)) {
      messageMap.set(
        parsedBlock.messageId,
        getMessageFallback(parsedProjection.sessionId, parsedBlock.messageId, parsedBlock.updatedAt)
      )
    }
  }

  const messages = [...messageMap.values()].sort(compareMessages)
  const blocksByMessageId = new Map<string, SemanticBlock[]>()

  for (const block of blockMap.values()) {
    const items = blocksByMessageId.get(block.messageId) ?? []
    items.push(block)
    blocksByMessageId.set(block.messageId, items)
  }

  for (const blockList of blocksByMessageId.values()) {
    blockList.sort(compareBlocks)
  }

  const normalizedMessages = messages.map((message) => {
    const blockList = blocksByMessageId.get(message.messageId) ?? []
    return {
      ...message,
      blockIds: blockList.map((block) => block.blockId)
    }
  })

  const blocks = normalizedMessages.flatMap((message) => blocksByMessageId.get(message.messageId) ?? [])
  const updatedAt = Math.max(
    parsedProjection.updatedAt,
    ...normalizedMessages.map((message) => message.updatedAt),
    ...blocks.map((block) => block.updatedAt),
    0
  )

  return {
    sessionId: parsedProjection.sessionId,
    version: parsedProjection.version,
    updatedAt,
    messages: normalizedMessages,
    blocks
  }
}

export function createSemanticSessionProjection(
  input: Pick<SemanticSessionProjection, 'sessionId'> & Partial<Omit<SemanticSessionProjection, 'sessionId'>>
): SemanticSessionProjection {
  return normalizeSemanticSessionProjection({
    sessionId: input.sessionId,
    version: input.version ?? 0,
    updatedAt: input.updatedAt ?? 0,
    messages: input.messages ?? [],
    blocks: input.blocks ?? []
  })
}

export function projectionFromSemanticSessionSnapshotV2(
  snapshot: SemanticSessionSnapshotV2
): SemanticSessionProjection {
  const parsedSnapshot = semanticSessionSnapshotV2Schema.parse(snapshot)
  return normalizeSemanticSessionProjection({
    sessionId: parsedSnapshot.sessionId,
    version: parsedSnapshot.version,
    updatedAt: parsedSnapshot.updatedAt,
    messages: parsedSnapshot.messages,
    blocks: parsedSnapshot.blocks
  })
}

export function createSemanticSessionSnapshotV2(
  projection: SemanticSessionProjection,
  snapshotSeqCeiling: number
): SemanticSessionSnapshotV2 {
  const normalizedProjection = normalizeSemanticSessionProjection(projection)
  return semanticSessionSnapshotV2Schema.parse({
    ...normalizedProjection,
    snapshotVersion: 2,
    snapshotSeqCeiling
  })
}

export function applySemanticEvent(
  projection: SemanticSessionProjection,
  event: SemanticEvent
): SemanticSessionProjection {
  const parsedProjection = normalizeSemanticSessionProjection(cloneProjection(projection))
  const parsedEvent = semanticEventSchema.parse(event)
  const nextProjection = cloneProjection(parsedProjection)
  const messageIndex = new Map(nextProjection.messages.map((message, index) => [message.messageId, index]))
  const blockIndex = new Map(nextProjection.blocks.map((block, index) => [block.blockId, index]))
  let eventUpdatedAt = nextProjection.updatedAt

  const upsertMessage = (message: SemanticMessage): void => {
    const existingIndex = messageIndex.get(message.messageId)
    if (existingIndex === undefined) {
      nextProjection.messages.push(message)
      return
    }

    nextProjection.messages[existingIndex] = {
      ...nextProjection.messages[existingIndex],
      ...message,
      blockIds: nextProjection.messages[existingIndex].blockIds
    }
  }

  const upsertBlock = (block: SemanticBlock): void => {
    const existingIndex = blockIndex.get(block.blockId)
    if (existingIndex === undefined) {
      nextProjection.blocks.push(block)
      return
    }

    nextProjection.blocks[existingIndex] = block
  }

  switch (parsedEvent.event) {
    case 'message.started': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          parsedEvent.payload.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage(
        semanticMessageSchema.parse({
          ...existingMessage,
          sessionId: parsedEvent.payload.sessionId,
          runId: parsedEvent.payload.runId ?? existingMessage.runId,
          messageId: parsedEvent.payload.messageId,
          role: parsedEvent.payload.role,
          status: parsedEvent.payload.status,
          createdAt: parsedEvent.payload.createdAt,
          updatedAt: parsedEvent.payload.updatedAt,
          metadata: mergeSemanticJsonObject(existingMessage.metadata, parsedEvent.payload.metadata),
          error: undefined
        })
      )
      break
    }
    case 'message.block.added': {
      const block = parsedEvent.payload.block
      eventUpdatedAt = block.updatedAt
      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          block.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage({
        ...existingMessage,
        sessionId: parsedEvent.payload.sessionId,
        runId: parsedEvent.payload.runId ?? existingMessage.runId,
        updatedAt: Math.max(existingMessage.updatedAt, block.updatedAt),
        status: existingMessage.status === 'pending' ? 'streaming' : existingMessage.status
      })

      upsertBlock(block)
      break
    }
    case 'message.block.updated': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      const existingBlock = nextProjection.blocks[blockIndex.get(parsedEvent.payload.blockId) ?? -1]
      if (!existingBlock) {
        return parsedProjection
      }

      upsertBlock({
        ...semanticBlockSchema.parse({
          ...existingBlock,
          status: parsedEvent.payload.patch.status ?? existingBlock.status,
          order: parsedEvent.payload.patch.order ?? existingBlock.order,
          metadata: mergeSemanticJsonObject(existingBlock.metadata, parsedEvent.payload.patch.metadata),
          content:
            parsedEvent.payload.patch.content === undefined
              ? existingBlock.content
              : mergeSemanticJsonValue(existingBlock.content, parsedEvent.payload.patch.content),
          error: parsedEvent.payload.patch.error ?? existingBlock.error,
          updatedAt: parsedEvent.payload.updatedAt
        })
      })

      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          parsedEvent.payload.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage({
        ...existingMessage,
        sessionId: parsedEvent.payload.sessionId,
        runId: parsedEvent.payload.runId ?? existingMessage.runId,
        updatedAt: Math.max(existingMessage.updatedAt, parsedEvent.payload.updatedAt),
        status: existingMessage.status === 'pending' ? 'streaming' : existingMessage.status
      })
      break
    }
    case 'message.block.completed': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      const existingBlock = nextProjection.blocks[blockIndex.get(parsedEvent.payload.blockId) ?? -1]
      if (!existingBlock) {
        return parsedProjection
      }

      upsertBlock({
        ...existingBlock,
        status: parsedEvent.payload.status,
        updatedAt: parsedEvent.payload.updatedAt
      })

      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          parsedEvent.payload.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage({
        ...existingMessage,
        sessionId: parsedEvent.payload.sessionId,
        runId: parsedEvent.payload.runId ?? existingMessage.runId,
        updatedAt: Math.max(existingMessage.updatedAt, parsedEvent.payload.updatedAt),
        status: existingMessage.status === 'pending' ? 'streaming' : existingMessage.status
      })
      break
    }
    case 'message.completed': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          parsedEvent.payload.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage({
        ...existingMessage,
        sessionId: parsedEvent.payload.sessionId,
        runId: parsedEvent.payload.runId ?? existingMessage.runId,
        updatedAt: parsedEvent.payload.updatedAt,
        status: parsedEvent.payload.status,
        error: undefined
      })

      if (parsedEvent.payload.version !== undefined) {
        nextProjection.version = parsedEvent.payload.version
      }
      break
    }
    case 'message.failed': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      const existingMessage =
        nextProjection.messages[messageIndex.get(parsedEvent.payload.messageId) ?? -1] ??
        getMessageFallback(
          parsedEvent.payload.sessionId,
          parsedEvent.payload.messageId,
          parsedEvent.payload.updatedAt,
          parsedEvent.payload.runId
        )

      upsertMessage({
        ...existingMessage,
        sessionId: parsedEvent.payload.sessionId,
        runId: parsedEvent.payload.runId ?? existingMessage.runId,
        updatedAt: parsedEvent.payload.updatedAt,
        status: 'error',
        error: {
          code: parsedEvent.payload.code,
          message: parsedEvent.payload.message,
          retryable: parsedEvent.payload.retryable
        }
      })

      if (parsedEvent.payload.version !== undefined) {
        nextProjection.version = parsedEvent.payload.version
      }
      break
    }
    case 'session.version.bump': {
      eventUpdatedAt = parsedEvent.payload.updatedAt
      nextProjection.version = parsedEvent.payload.version
      nextProjection.updatedAt = parsedEvent.payload.updatedAt
      break
    }
    case 'session.snapshot': {
      return projectionFromSemanticSessionSnapshotV2(parsedEvent.payload)
    }
  }

  nextProjection.updatedAt = Math.max(nextProjection.updatedAt, eventUpdatedAt)
  return normalizeSemanticSessionProjection(nextProjection)
}

export function reduceSemanticEvents(
  events: readonly SemanticEvent[],
  initialProjection: SemanticSessionProjection
): SemanticSessionProjection {
  return events.reduce(
    (currentProjection, event) => applySemanticEvent(currentProjection, event),
    normalizeSemanticSessionProjection(initialProjection)
  )
}
