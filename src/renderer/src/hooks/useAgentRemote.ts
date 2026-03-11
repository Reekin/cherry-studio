import { useCallback, useEffect, useRef, useState } from 'react'

export interface AgentRemoteRendererStatus {
  enabled: boolean
  relayUrl: string | null
  deviceId: string
  state: string
  bridgeOnline: boolean
  updatedAt: number
  lastError?: string
}

export interface AgentRemoteRendererEvent {
  event: 'bridge.online' | 'bridge.offline' | 'session.pushed' | 'session.version.bump'
  payload: Record<string, unknown>
  ts: number
}

const statusCallbacks = new Set<(status: AgentRemoteRendererStatus) => void>()
const eventCallbacks = new Set<(event: AgentRemoteRendererEvent) => void>()
let removeIpcListener: (() => void) | null = null
let removeIpcEventListener: (() => void) | null = null

const ensureSubscribed = () => {
  if (!removeIpcListener) {
    removeIpcListener = window.api.agentRemote.onStatusChanged((status) => {
      statusCallbacks.forEach((callback) => callback(status))
    })
  }

  if (!removeIpcEventListener) {
    removeIpcEventListener = window.api.agentRemote.onEventPublished((event) => {
      eventCallbacks.forEach((callback) => callback(event))
    })
  }
}

const cleanupSubscription = () => {
  if (statusCallbacks.size === 0 && eventCallbacks.size === 0 && removeIpcListener) {
    removeIpcListener()
    removeIpcListener = null
  }

  if (statusCallbacks.size === 0 && eventCallbacks.size === 0 && removeIpcEventListener) {
    removeIpcEventListener()
    removeIpcEventListener = null
  }
}

const emptyStatus: AgentRemoteRendererStatus = {
  enabled: false,
  relayUrl: null,
  deviceId: '',
  state: 'idle',
  bridgeOnline: false,
  updatedAt: 0
}

export function useAgentRemote() {
  const [status, setStatus] = useState<AgentRemoteRendererStatus>(emptyStatus)
  const [lastEvent, setLastEvent] = useState<AgentRemoteRendererEvent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const loadStatusRef = useRef<() => Promise<void>>(async () => {})

  const loadStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      const nextStatus = await window.api.agentRemote.getStatus()
      setStatus(nextStatus)
    } finally {
      setIsLoading(false)
    }
  }, [])

  loadStatusRef.current = loadStatus

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    ensureSubscribed()
    const handleStatusChanged = (nextStatus: AgentRemoteRendererStatus) => {
      setStatus(nextStatus)
      setIsLoading(false)
    }
    const handleEventPublished = (event: AgentRemoteRendererEvent) => {
      setLastEvent(event)
    }

    statusCallbacks.add(handleStatusChanged)
    eventCallbacks.add(handleEventPublished)
    return () => {
      statusCallbacks.delete(handleStatusChanged)
      eventCallbacks.delete(handleEventPublished)
      cleanupSubscription()
    }
  }, [])

  const pushSession = useCallback(async (payload: { sessionId: string; agentId: string }) => {
    return window.api.agentRemote.pushSession(payload)
  }, [])

  const refresh = useCallback(async () => {
    await loadStatusRef.current()
  }, [])

  return {
    status,
    lastEvent,
    isLoading,
    pushSession,
    refresh
  }
}
