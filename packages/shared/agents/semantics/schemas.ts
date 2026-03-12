import * as z from 'zod'

export type SemanticJsonValue =
  | string
  | number
  | boolean
  | null
  | SemanticJsonValue[]
  | { [key: string]: SemanticJsonValue }

export const semanticJsonValueSchema: z.ZodType<SemanticJsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(semanticJsonValueSchema), semanticJsonObjectSchema])
)

export const semanticJsonObjectSchema: z.ZodType<Record<string, SemanticJsonValue>> = z.record(
  z.string(),
  semanticJsonValueSchema
)

export const semanticMetadataSchema = semanticJsonObjectSchema
export type SemanticMetadata = z.infer<typeof semanticMetadataSchema>

export const semanticMessageRoleSchema = z.enum(['assistant', 'user', 'system', 'tool'])
export type SemanticMessageRole = z.infer<typeof semanticMessageRoleSchema>

// Keep the runtime vocabulary aligned with Cherry Studio's actual persisted message and block states.
export const semanticMessageStatusSchema = z.enum(['pending', 'processing', 'streaming', 'success', 'error', 'paused'])
export type SemanticMessageStatus = z.infer<typeof semanticMessageStatusSchema>

export const semanticBlockStatusSchema = semanticMessageStatusSchema
export type SemanticBlockStatus = z.infer<typeof semanticBlockStatusSchema>

export const semanticTerminalBlockStatusSchema = z.enum(['success', 'error', 'paused'])
export type SemanticTerminalBlockStatus = z.infer<typeof semanticTerminalBlockStatusSchema>

export const semanticBlockTypeSchema = z.enum([
  'unknown',
  'main_text',
  'thinking',
  'translation',
  'image',
  'code',
  'tool',
  'file',
  'error',
  'citation',
  'video',
  'compact'
])
export type SemanticBlockType = z.infer<typeof semanticBlockTypeSchema>

export const semanticMessageErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().default(false)
})
export type SemanticMessageError = z.infer<typeof semanticMessageErrorSchema>

export const semanticBlockSchema = z.object({
  blockId: z.string().min(1),
  messageId: z.string().min(1),
  type: semanticBlockTypeSchema,
  status: semanticBlockStatusSchema,
  order: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  content: z.unknown().optional(),
  metadata: semanticMetadataSchema.optional(),
  error: semanticMessageErrorSchema.optional()
})
export type SemanticBlock = z.infer<typeof semanticBlockSchema>

export const semanticMessageSchema = z.object({
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  role: semanticMessageRoleSchema,
  status: semanticMessageStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  blockIds: z.array(z.string().min(1)).default([]),
  metadata: semanticMetadataSchema.optional(),
  error: semanticMessageErrorSchema.optional()
})
export type SemanticMessage = z.infer<typeof semanticMessageSchema>

export const semanticSessionProjectionSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().nonnegative().default(0),
  updatedAt: z.number().int().nonnegative().default(0),
  messages: z.array(semanticMessageSchema).default([]),
  blocks: z.array(semanticBlockSchema).default([])
})
export type SemanticSessionProjection = z.infer<typeof semanticSessionProjectionSchema>

export const semanticSessionSnapshotV2Schema = semanticSessionProjectionSchema.extend({
  snapshotVersion: z.literal(2),
  snapshotSeqCeiling: z.number().int().nonnegative()
})
export type SemanticSessionSnapshotV2 = z.infer<typeof semanticSessionSnapshotV2Schema>

export const semanticBlockPatchSchema = z
  .object({
    type: semanticBlockTypeSchema.optional(),
    status: semanticBlockStatusSchema.optional(),
    order: z.number().int().nonnegative().optional(),
    metadata: semanticMetadataSchema.optional(),
    content: z.unknown().optional(),
    error: semanticMessageErrorSchema.optional()
  })
  .strict()
export type SemanticBlockPatch = z.infer<typeof semanticBlockPatchSchema>

export const semanticEventNames = [
  'message.started',
  'message.block.added',
  'message.block.updated',
  'message.block.completed',
  'message.completed',
  'message.failed',
  'session.version.bump',
  'session.snapshot'
] as const

export const semanticEventNameSchema = z.enum(semanticEventNames)
export type SemanticEventName = z.infer<typeof semanticEventNameSchema>

export const semanticMessageStartedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  role: semanticMessageRoleSchema,
  status: z.enum(['pending', 'processing', 'streaming']).default('streaming'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  metadata: semanticMetadataSchema.optional()
})
export type SemanticMessageStartedPayload = z.infer<typeof semanticMessageStartedPayloadSchema>

export const semanticMessageBlockAddedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  block: semanticBlockSchema
})
export type SemanticMessageBlockAddedPayload = z.infer<typeof semanticMessageBlockAddedPayloadSchema>

export const semanticMessageBlockUpdatedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  blockId: z.string().min(1),
  patch: semanticBlockPatchSchema,
  updatedAt: z.number().int().nonnegative()
})
export type SemanticMessageBlockUpdatedPayload = z.infer<typeof semanticMessageBlockUpdatedPayloadSchema>

export const semanticMessageBlockCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  blockId: z.string().min(1),
  status: semanticTerminalBlockStatusSchema,
  updatedAt: z.number().int().nonnegative()
})
export type SemanticMessageBlockCompletedPayload = z.infer<typeof semanticMessageBlockCompletedPayloadSchema>

export const semanticMessageCompletedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  status: z.enum(['success', 'paused']).default('success'),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative()
})
export type SemanticMessageCompletedPayload = z.infer<typeof semanticMessageCompletedPayloadSchema>

export const semanticMessageFailedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  messageId: z.string().min(1),
  status: z.literal('error').default('error'),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative()
})
export type SemanticMessageFailedPayload = z.infer<typeof semanticMessageFailedPayloadSchema>

export const semanticSessionVersionBumpPayloadSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type SemanticSessionVersionBumpPayload = z.infer<typeof semanticSessionVersionBumpPayloadSchema>

export const semanticMessageStartedEventSchema = z.object({
  event: z.literal('message.started'),
  payload: semanticMessageStartedPayloadSchema
})
export type SemanticMessageStartedEvent = z.infer<typeof semanticMessageStartedEventSchema>

export const semanticMessageBlockAddedEventSchema = z.object({
  event: z.literal('message.block.added'),
  payload: semanticMessageBlockAddedPayloadSchema
})
export type SemanticMessageBlockAddedEvent = z.infer<typeof semanticMessageBlockAddedEventSchema>

export const semanticMessageBlockUpdatedEventSchema = z.object({
  event: z.literal('message.block.updated'),
  payload: semanticMessageBlockUpdatedPayloadSchema
})
export type SemanticMessageBlockUpdatedEvent = z.infer<typeof semanticMessageBlockUpdatedEventSchema>

export const semanticMessageBlockCompletedEventSchema = z.object({
  event: z.literal('message.block.completed'),
  payload: semanticMessageBlockCompletedPayloadSchema
})
export type SemanticMessageBlockCompletedEvent = z.infer<typeof semanticMessageBlockCompletedEventSchema>

export const semanticMessageCompletedEventSchema = z.object({
  event: z.literal('message.completed'),
  payload: semanticMessageCompletedPayloadSchema
})
export type SemanticMessageCompletedEvent = z.infer<typeof semanticMessageCompletedEventSchema>

export const semanticMessageFailedEventSchema = z.object({
  event: z.literal('message.failed'),
  payload: semanticMessageFailedPayloadSchema
})
export type SemanticMessageFailedEvent = z.infer<typeof semanticMessageFailedEventSchema>

export const semanticSessionVersionBumpEventSchema = z.object({
  event: z.literal('session.version.bump'),
  payload: semanticSessionVersionBumpPayloadSchema
})
export type SemanticSessionVersionBumpEvent = z.infer<typeof semanticSessionVersionBumpEventSchema>

export const semanticSessionSnapshotEventSchema = z.object({
  event: z.literal('session.snapshot'),
  payload: semanticSessionSnapshotV2Schema
})
export type SemanticSessionSnapshotEvent = z.infer<typeof semanticSessionSnapshotEventSchema>

export const semanticEventSchema = z.discriminatedUnion('event', [
  semanticMessageStartedEventSchema,
  semanticMessageBlockAddedEventSchema,
  semanticMessageBlockUpdatedEventSchema,
  semanticMessageBlockCompletedEventSchema,
  semanticMessageCompletedEventSchema,
  semanticMessageFailedEventSchema,
  semanticSessionVersionBumpEventSchema,
  semanticSessionSnapshotEventSchema
])
export type SemanticEvent = z.infer<typeof semanticEventSchema>
