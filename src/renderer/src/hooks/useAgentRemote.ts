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

const statusCallbacks = new Set<(status: AgentRemoteRendererStatus) => void>()
let removeIpcListener: (() => void) | null = null

const ensureSubscribed = () => {
  if (!removeIpcListener) {
    removeIpcListener = window.api.agentRemote.onStatusChanged((status) => {
      statusCallbacks.forEach((callback) => callback(status))
    })
  }
}

const cleanupSubscription = () => {
  if (statusCallbacks.size === 0 && removeIpcListener) {
    removeIpcListener()
    removeIpcListener = null
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

    statusCallbacks.add(handleStatusChanged)
    return () => {
      statusCallbacks.delete(handleStatusChanged)
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
    isLoading,
    pushSession,
    refresh
  }
}
