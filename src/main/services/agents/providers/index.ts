import type { AgentType } from '@types'

import { builtinSlashCommands } from '../services/claudecode/commands'
import { builtinTools } from '../services/claudecode/tools'
import type { AgentProviderDescriptor } from './types'

const providerDescriptors = {
  'claude-code': {
    type: 'claude-code',
    displayName: 'Claude Code',
    capabilities: {
      supportsStreaming: true,
      requiresModelValidation: true
    },
    builtinTools,
    builtinSlashCommands,
    async loadRuntime() {
      const module = await import('../services/claudecode')
      return new module.default()
    }
  },
  codex: {
    type: 'codex',
    displayName: 'Codex',
    capabilities: {
      supportsStreaming: true,
      requiresModelValidation: false
    },
    builtinTools: [],
    builtinSlashCommands: [],
    async loadRuntime() {
      const module = await import('./codex')
      return new module.CodexProvider()
    }
  }
} satisfies Record<AgentType, AgentProviderDescriptor>

export function getAgentProviderDescriptor(type: AgentType): AgentProviderDescriptor {
  return providerDescriptors[type]
}

export async function loadAgentProviderRuntime(type: AgentType) {
  return providerDescriptors[type].loadRuntime()
}

export { type AgentProviderCapabilities, type AgentProviderDescriptor } from './types'
