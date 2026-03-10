import * as z from 'zod'

import {
  remoteAckEvents,
  remoteCommandEvents,
  remoteEnvelopeTypes,
  remoteErrorCodes,
  remoteEventEvents,
  remoteOrigins,
  remoteRunPushPolicies
} from './constants'

export const remoteOriginSchema = z.enum(remoteOrigins)
export type RemoteOrigin = z.infer<typeof remoteOriginSchema>

export const remoteRunPushPolicySchema = z.enum(remoteRunPushPolicies)
export type RemoteRunPushPolicy = z.infer<typeof remoteRunPushPolicySchema>

export const remoteEnvelopeTypeSchema = z.enum(remoteEnvelopeTypes)
export type RemoteEnvelopeType = z.infer<typeof remoteEnvelopeTypeSchema>

export const remoteCommandEventSchema = z.enum(remoteCommandEvents)
export type RemoteCommandEvent = z.infer<typeof remoteCommandEventSchema>

export const remoteEventEventSchema = z.enum(remoteEventEvents)
export type RemoteEventEvent = z.infer<typeof remoteEventEventSchema>

export const remoteAckEventSchema = z.enum(remoteAckEvents)
export type RemoteAckEvent = z.infer<typeof remoteAckEventSchema>

export const remoteErrorCodeSchema = z.enum(remoteErrorCodes)
export type RemoteErrorCode = z.infer<typeof remoteErrorCodeSchema>

const remoteBaseEnvelopeSchema = z.object({
  type: remoteEnvelopeTypeSchema,
  event: z.string(),
  runId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().int().nonnegative(),
  payload: z.unknown()
})

export const runRegisterPayloadSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  origin: z.literal('desktop'),
  deviceId: z.string().min(1)
})
export type RunRegisterPayload = z.infer<typeof runRegisterPayloadSchema>

export const sessionCreatePayloadSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().min(1).optional(),
  clientSessionId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})
export type SessionCreatePayload = z.infer<typeof sessionCreatePayloadSchema>

export const messageSendPayloadSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  content: z.string().min(1),
  messageId: z.string().min(1).optional(),
  origin: remoteOriginSchema,
  runPushPolicy: remoteRunPushPolicySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})
export type MessageSendPayload = z.infer<typeof messageSendPayloadSchema>

export const sessionSnapshotPayloadSchema = z.object({
  sessionId: z.string().min(1),
  snapshotVersion: z.number().int().nonnegative().optional()
})
export type SessionSnapshotPayload = z.infer<typeof sessionSnapshotPayloadSchema>

export const ackCommitPayloadSchema = z.object({
  deviceId: z.string().min(1),
  ackSeq: z.number().int().nonnegative()
})
export type AckCommitPayload = z.infer<typeof ackCommitPayloadSchema>

export const sessionCreatedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  title: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  origin: remoteOriginSchema.optional(),
  runPushPolicy: remoteRunPushPolicySchema.optional()
})
export type SessionCreatedPayload = z.infer<typeof sessionCreatedPayloadSchema>

export const sessionPushedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  pushedAt: z.number().int().nonnegative(),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
export type SessionPushedPayload = z.infer<typeof sessionPushedPayloadSchema>

export const messageDeltaPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().uuid().optional(),
  messageId: z.string().min(1).default('assistant'),
  role: z.enum(['assistant', 'user', 'system', 'tool']).default('assistant'),
  delta: z.string(),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
export type MessageDeltaPayload = z.infer<typeof messageDeltaPayloadSchema>

export const messageDonePayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().uuid().optional(),
  messageId: z.string().min(1).default('assistant'),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  status: z.enum(['success', 'cancelled']).default('success')
})
export type MessageDonePayload = z.infer<typeof messageDonePayloadSchema>

export const messageErrorPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().uuid().optional(),
  messageId: z.string().min(1).default('assistant'),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional().default(false),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
export type MessageErrorPayload = z.infer<typeof messageErrorPayloadSchema>

export const remoteSnapshotMessageSchema = z.object({
  messageId: z.string().min(1),
  runId: z.string().uuid().optional(),
  role: z.enum(['assistant', 'user', 'system', 'tool']),
  content: z.string(),
  status: z.enum(['streaming', 'done', 'error']).default('done'),
  updatedAt: z.number().int().nonnegative().optional()
})
export type RemoteSnapshotMessage = z.infer<typeof remoteSnapshotMessageSchema>

export const sessionSnapshotEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  snapshotVersion: z.number().int().nonnegative(),
  snapshotSeqCeiling: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative().optional(),
  messages: z.array(remoteSnapshotMessageSchema)
})
export type SessionSnapshotEventPayload = z.infer<typeof sessionSnapshotEventPayloadSchema>

export const sessionVersionBumpPayloadSchema = z.object({
  sessionId: z.string().min(1),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})
export type SessionVersionBumpPayload = z.infer<typeof sessionVersionBumpPayloadSchema>

export const bridgeStatusPayloadSchema = z.object({
  deviceId: z.string().min(1),
  status: z.enum(['online', 'offline'])
})
export type BridgeStatusPayload = z.infer<typeof bridgeStatusPayloadSchema>

export const remoteErrorPayloadSchema = z.object({
  code: remoteErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  sessionId: z.string().optional()
})
export type RemoteErrorPayload = z.infer<typeof remoteErrorPayloadSchema>

export const remoteCmdEnvelopeSchema = z.discriminatedUnion('event', [
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('run.register'),
    payload: runRegisterPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('session.create'),
    payload: sessionCreatePayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('message.send'),
    payload: messageSendPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('session.snapshot'),
    payload: sessionSnapshotPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('agent.list'),
    payload: z.object({}).passthrough()
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('session.list'),
    payload: z.object({}).passthrough()
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('message.cancel'),
    payload: z.object({
      runId: z.string().uuid()
    })
  })
])
export type RemoteCmdEnvelope = z.infer<typeof remoteCmdEnvelopeSchema>

export const remoteEvtEnvelopeSchema = z.discriminatedUnion('event', [
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('session.created'),
    payload: sessionCreatedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('session.pushed'),
    payload: sessionPushedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('session.snapshot'),
    payload: sessionSnapshotEventPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.delta'),
    payload: messageDeltaPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.done'),
    payload: messageDonePayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.error'),
    payload: messageErrorPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('session.version.bump'),
    payload: sessionVersionBumpPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('bridge.online'),
    payload: bridgeStatusPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('bridge.offline'),
    payload: bridgeStatusPayloadSchema
  })
])
export type RemoteEvtEnvelope = z.infer<typeof remoteEvtEnvelopeSchema>

export const remoteAckEnvelopeSchema = remoteBaseEnvelopeSchema.extend({
  type: z.literal('ack'),
  event: z.literal('ack.commit'),
  payload: ackCommitPayloadSchema
})
export type RemoteAckEnvelope = z.infer<typeof remoteAckEnvelopeSchema>

export const remoteErrEnvelopeSchema = remoteBaseEnvelopeSchema.extend({
  type: z.literal('err'),
  event: z.literal('error'),
  payload: remoteErrorPayloadSchema
})
export type RemoteErrEnvelope = z.infer<typeof remoteErrEnvelopeSchema>

export const remoteEnvelopeSchema = z.union([
  remoteCmdEnvelopeSchema,
  remoteEvtEnvelopeSchema,
  remoteAckEnvelopeSchema,
  remoteErrEnvelopeSchema
])
export type RemoteEnvelope = z.infer<typeof remoteEnvelopeSchema>

export const remoteSnapshotResponseSchema = z.object({
  sessionId: z.string().min(1),
  snapshotVersion: z.number().int().nonnegative(),
  snapshotSeqCeiling: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative().optional(),
  messages: z.array(remoteSnapshotMessageSchema)
})
export type RemoteSnapshotResponse = z.infer<typeof remoteSnapshotResponseSchema>
