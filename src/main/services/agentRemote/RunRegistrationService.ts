import { loggerService } from '@logger'

import type { BridgeSocketClient } from './BridgeSocketClient'
import { createRemoteCommandEnvelope, type RegisterDesktopRunInput } from './types'

const logger = loggerService.withContext('RunRegistrationService')

export class RunRegistrationService {
  constructor(
    private readonly socketClient: BridgeSocketClient,
    private readonly deviceId: string
  ) {}

  registerDesktopRun(input: RegisterDesktopRunInput): { accepted: boolean; requestId: string } {
    const envelope = createRemoteCommandEnvelope(
      'run.register',
      {
        sessionId: input.sessionId,
        agentId: input.agentId,
        origin: 'desktop',
        deviceId: this.deviceId
      },
      {
        runId: input.runId
      }
    )

    const accepted = this.socketClient.send(envelope)
    if (!accepted) {
      logger.warn('Failed to register desktop-origin run with relay', {
        runId: input.runId,
        sessionId: input.sessionId
      })
    }

    return {
      accepted,
      requestId: envelope.requestId ?? input.runId
    }
  }
}
