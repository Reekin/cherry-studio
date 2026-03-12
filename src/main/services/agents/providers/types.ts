import type { AgentType, SlashCommand, Tool } from '@types'

import type { AgentServiceInterface } from '../interfaces/AgentStreamInterface'

export interface AgentProviderCapabilities {
  supportsStreaming: boolean
  requiresModelValidation: boolean
}

export interface AgentProviderDescriptor {
  readonly type: AgentType
  readonly displayName: string
  readonly capabilities: AgentProviderCapabilities
  readonly builtinTools: Tool[]
  readonly builtinSlashCommands: SlashCommand[]
  loadRuntime(): Promise<AgentServiceInterface>
}
