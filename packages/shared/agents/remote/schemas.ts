import * as z from 'zod'

import {
  semanticMessageBlockAddedPayloadSchema,
  semanticMessageBlockCompletedPayloadSchema,
  semanticMessageBlockUpdatedPayloadSchema,
  semanticMessageCompletedPayloadSchema,
  semanticMessageFailedPayloadSchema,
  semanticMessageStartedPayloadSchema,
  semanticSessionSnapshotV2Schema,
  semanticSessionVersionBumpPayloadSchema
} from '../semantics/index.js'
import {
  remoteAckEvents,
  remoteCommandEvents,
  remoteEnvelopeTypes,
  remoteErrorCodes,
  remoteEventEvents,
  remoteOrigins,
  remoteRunPushPolicies
} from './constants.js'

export const remoteOriginSchema = z.enum(remoteOrigins)
export type RemoteOrigin = z.infer<typeof remoteOriginSchema>

export const remoteRunPushPolicySchema = z.enum(remoteRunPushPolicies)
export type RemoteRunPushPolicy = z.infer<typeof remoteRunPushPolicySchema>

export const remoteAgentProviderSchema = z.enum(['claude-code', 'codex'])
export type RemoteAgentProvider = z.infer<typeof remoteAgentProviderSchema>

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

export const remoteAgentPermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan'])
export type RemoteAgentPermissionMode = z.infer<typeof remoteAgentPermissionModeSchema>

export const remoteRunIdSchema = z.string().min(1)
export type RemoteRunId = z.infer<typeof remoteRunIdSchema>

const remoteBaseEnvelopeSchema = z.object({
  type: remoteEnvelopeTypeSchema,
  event: z.string(),
  runId: remoteRunIdSchema.optional(),
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

export const remoteAgentSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().default(''),
  directories: z.array(z.string()).default([]),
  provider: remoteAgentProviderSchema,
  permissionMode: remoteAgentPermissionModeSchema.default('bypassPermissions'),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
export type RemoteAgent = z.infer<typeof remoteAgentSchema>

export const agentListPayloadSchema = z.object({}).passthrough()
export type AgentListPayload = z.infer<typeof agentListPayloadSchema>

export const agentUpsertPayloadSchema = remoteAgentSchema.extend({
  agentId: z.string().min(1).optional()
})
export type AgentUpsertPayload = z.infer<typeof agentUpsertPayloadSchema>

export const agentDeletePayloadSchema = z.object({
  agentId: z.string().min(1)
})
export type AgentDeletePayload = z.infer<typeof agentDeletePayloadSchema>

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

export const agentListedPayloadSchema = z.object({
  agents: z.array(remoteAgentSchema).default([])
})
export type AgentListedPayload = z.infer<typeof agentListedPayloadSchema>

export const agentUpsertedPayloadSchema = z.object({
  agent: remoteAgentSchema
})
export type AgentUpsertedPayload = z.infer<typeof agentUpsertedPayloadSchema>

export const agentDeletedPayloadSchema = z.object({
  agentId: z.string().min(1)
})
export type AgentDeletedPayload = z.infer<typeof agentDeletedPayloadSchema>

export const sessionPushedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  pushedAt: z.number().int().nonnegative(),
  version: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
export type SessionPushedPayload = z.infer<typeof sessionPushedPayloadSchema>

export const sessionSnapshotV2PayloadSchema = semanticSessionSnapshotV2Schema
export type SessionSnapshotV2Payload = z.infer<typeof sessionSnapshotV2PayloadSchema>

export const sessionSnapshotEventPayloadSchema = sessionSnapshotV2PayloadSchema
export type SessionSnapshotEventPayload = z.infer<typeof sessionSnapshotEventPayloadSchema>

export const sessionVersionBumpPayloadSchema = semanticSessionVersionBumpPayloadSchema
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
    event: z.literal('agent.list'),
    payload: agentListPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('agent.upsert'),
    payload: agentUpsertPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('agent.delete'),
    payload: agentDeletePayloadSchema
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
    event: z.literal('session.list'),
    payload: z.object({}).passthrough()
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('cmd'),
    event: z.literal('message.cancel'),
    payload: z.object({
      runId: remoteRunIdSchema
    })
  })
])
export type RemoteCmdEnvelope = z.infer<typeof remoteCmdEnvelopeSchema>

export const remoteEvtEnvelopeSchema = z.discriminatedUnion('event', [
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('agent.listed'),
    payload: agentListedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('agent.upserted'),
    payload: agentUpsertedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('agent.deleted'),
    payload: agentDeletedPayloadSchema
  }),
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
    event: z.literal('message.started'),
    payload: semanticMessageStartedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.block.added'),
    payload: semanticMessageBlockAddedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.block.updated'),
    payload: semanticMessageBlockUpdatedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.block.completed'),
    payload: semanticMessageBlockCompletedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.completed'),
    payload: semanticMessageCompletedPayloadSchema
  }),
  remoteBaseEnvelopeSchema.extend({
    type: z.literal('evt'),
    event: z.literal('message.failed'),
    payload: semanticMessageFailedPayloadSchema
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

export const remoteSnapshotResponseSchema = sessionSnapshotEventPayloadSchema
export type RemoteSnapshotResponse = z.infer<typeof remoteSnapshotResponseSchema>
