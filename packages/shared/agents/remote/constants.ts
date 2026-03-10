export const remoteOrigins = ['ios', 'desktop'] as const

export const remoteRunPushPolicies = ['full', 'meta_only'] as const

export const remoteEnvelopeTypes = ['cmd', 'evt', 'ack', 'err'] as const

export const remoteCommandEvents = [
  'agent.list',
  'session.list',
  'session.create',
  'message.send',
  'message.cancel',
  'session.snapshot',
  'run.register'
] as const

export const remoteEventEvents = [
  'session.created',
  'session.pushed',
  'session.snapshot',
  'message.delta',
  'message.done',
  'message.error',
  'session.version.bump',
  'bridge.online',
  'bridge.offline'
] as const

export const remoteAckEvents = ['ack.commit'] as const

export const remoteErrorCodes = [
  'VALIDATION_FAILED',
  'BRIDGE_OFFLINE',
  'SNAPSHOT_REQUIRED',
  'ACK_GAP_DETECTED',
  'IDEMPOTENCY_KEY_REUSED',
  'COMMAND_RECOVERY_REQUIRED'
] as const
