import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { MESSAGE_STREAM_TIMEOUT_MS } from '@main/apiServer/config/timeouts'
import {
  createStreamAbortController,
  STREAM_TIMEOUT_REASON,
  type StreamAbortController
} from '@main/apiServer/utils/createStreamAbortController'
import { agentRemoteService } from '@main/services/agentRemote'
import { agentService, sessionMessageService, sessionService } from '@main/services/agents'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerMessagesHandlers')
const DESKTOP_SNAPSHOT_POLL_MS = 150
const DESKTOP_SNAPSHOT_TIMEOUT_MS = 4_000

const waitForStableDesktopSnapshot = async (sessionId: string, baselineVersion: number, baselineUpdatedAt: number) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < DESKTOP_SNAPSHOT_TIMEOUT_MS) {
    const snapshot = await agentRemoteService.getSnapshotProvider().getSessionSnapshot(sessionId)

    if (snapshot && (snapshot.snapshotVersion > baselineVersion || snapshot.updatedAt > baselineUpdatedAt)) {
      return snapshot
    }

    await new Promise((resolve) => setTimeout(resolve, DESKTOP_SNAPSHOT_POLL_MS))
  }

  return null
}

// Helper function to verify agent and session exist and belong together
const verifyAgentAndSession = async (agentId: string, sessionId: string) => {
  const agentExists = await agentService.agentExists(agentId)
  if (!agentExists) {
    throw { status: 404, code: 'agent_not_found', message: 'Agent not found' }
  }

  const session = await sessionService.getSession(agentId, sessionId)
  if (!session) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found' }
  }

  if (session.agent_id !== agentId) {
    throw { status: 404, code: 'session_not_found', message: 'Session not found for this agent' }
  }

  return session
}

export const createMessage = async (req: Request, res: Response): Promise<void> => {
  let streamController: StreamAbortController | undefined

  try {
    const { agentId, sessionId } = req.params

    const session = await verifyAgentAndSession(agentId, sessionId)
    const messageData = req.body

    logger.info('Creating streaming message', { agentId, sessionId })
    logger.debug('Streaming message payload', { messageData })

    const desktopRunId = randomUUID()
    const desktopRunRegistration = agentRemoteService.registerDesktopRun({
      runId: desktopRunId,
      sessionId,
      agentId
    })
    const baselineSnapshot = desktopRunRegistration.accepted
      ? await agentRemoteService.getSnapshotProvider().getSessionSnapshot(sessionId)
      : null

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control')

    streamController = createStreamAbortController({
      timeoutMs: MESSAGE_STREAM_TIMEOUT_MS
    })
    const { abortController, registerAbortHandler, dispose } = streamController
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      messageData,
      abortController
    )
    const reader = stream.getReader()

    let responseEnded = false
    let streamFinished = false

    const cleanup = () => {
      dispose()
    }

    const finalizeResponse = () => {
      if (responseEnded || !streamFinished) {
        return
      }

      responseEnded = true
      cleanup()
      try {
        res.write('data: [DONE]\n\n')
      } catch (writeError) {
        logger.error('Error writing final sentinel to SSE stream', { error: writeError as Error })
      }
      res.end()
    }

    registerAbortHandler((abortReason) => {
      cleanup()

      if (responseEnded) return

      responseEnded = true

      if (abortReason === STREAM_TIMEOUT_REASON) {
        logger.error('Streaming message timeout', { agentId, sessionId })
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: {
                message: 'Stream timeout',
                type: 'timeout_error',
                code: 'stream_timeout'
              }
            })}\n\n`
          )
        } catch (writeError) {
          logger.error('Error writing timeout to SSE stream', { error: writeError })
        }
      } else if (abortReason === 'Client disconnected') {
        logger.info('Streaming client disconnected', { agentId, sessionId })
      } else {
        logger.warn('Streaming aborted', { agentId, sessionId, reason: abortReason })
      }

      reader.cancel(abortReason ?? 'stream aborted').catch(() => {})

      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
      }

      if (!res.writableEnded) {
        res.end()
      }
    })

    const handleDisconnect = () => {
      if (abortController.signal.aborted) return
      abortController.abort('Client disconnected')
    }

    req.on('close', handleDisconnect)
    req.on('aborted', handleDisconnect)
    res.on('close', handleDisconnect)

    const pumpStream = async () => {
      try {
        while (!responseEnded) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          res.write(`data: ${JSON.stringify(value)}\n\n`)
        }

        streamFinished = true
        finalizeResponse()
      } catch (error) {
        if (responseEnded) return
        logger.error('Error reading agent stream', { error })
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: {
                message: (error as Error).message || 'Stream processing error',
                type: 'stream_error',
                code: 'stream_processing_failed'
              }
            })}\n\n`
          )
        } catch (writeError) {
          logger.error('Error writing stream error to SSE', { error: writeError })
        }
        responseEnded = true
        cleanup()
        res.end()
      }
    }

    pumpStream().catch((error) => {
      logger.error('Pump stream failure', { error })
    })

    completion
      .then(() => {
        streamFinished = true
        if (desktopRunRegistration.accepted) {
          void waitForStableDesktopSnapshot(
            sessionId,
            baselineSnapshot?.snapshotVersion ?? 0,
            baselineSnapshot?.updatedAt ?? 0
          )
            .then((snapshot) => {
              if (!snapshot) {
                logger.warn('Skipped desktop-origin version bump because snapshot did not advance in time', {
                  agentId,
                  sessionId,
                  baselineVersion: baselineSnapshot?.snapshotVersion ?? 0
                })
                return
              }

              agentRemoteService.publishSessionVersionBump({
                sessionId,
                version: snapshot.snapshotVersion,
                updatedAt: snapshot.updatedAt
              })
            })
            .catch((snapshotError) => {
              logger.warn('Failed to publish desktop-origin version bump', {
                agentId,
                sessionId,
                error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
              })
            })
        }
        finalizeResponse()
      })
      .catch((error) => {
        if (responseEnded) return
        logger.error('Streaming message error', { agentId, sessionId, error })
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: {
                message: (error as { message?: string })?.message || 'Stream processing error',
                type: 'stream_error',
                code: 'stream_processing_failed'
              }
            })}\n\n`
          )
        } catch (writeError) {
          logger.error('Error writing completion error to SSE stream', { error: writeError })
        }
        responseEnded = true
        cleanup()
        res.end()
      })

    res.on('close', cleanup)
    res.on('finish', cleanup)
  } catch (error: any) {
    streamController?.dispose()
    logger.error('Error in streaming message handler', {
      error,
      agentId: req.params.agentId,
      sessionId: req.params.sessionId
    })

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
    }

    try {
      const errorResponse = {
        type: 'error',
        error: {
          message: error.status ? error.message : 'Failed to create streaming message',
          type: error.status ? 'not_found' : 'internal_error',
          code: error.status ? error.code : 'stream_creation_failed'
        }
      }

      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`)
    } catch (writeError) {
      logger.error('Error writing initial error to SSE stream', { error: writeError })
    }

    res.end()
  }
}

export const deleteMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { agentId, sessionId, messageId: messageIdParam } = req.params
    const messageId = Number(messageIdParam)

    await verifyAgentAndSession(agentId, sessionId)

    const deleted = await sessionMessageService.deleteSessionMessage(sessionId, messageId)

    if (!deleted) {
      logger.warn('Session message not found', { agentId, sessionId, messageId })
      return res.status(404).json({
        error: {
          message: 'Message not found for this session',
          type: 'not_found',
          code: 'session_message_not_found'
        }
      })
    }

    logger.info('Session message deleted', { agentId, sessionId, messageId })
    return res.status(204).send()
  } catch (error: any) {
    if (error?.status === 404) {
      logger.warn('Delete message failed - missing resource', {
        agentId: req.params.agentId,
        sessionId: req.params.sessionId,
        messageId: req.params.messageId,
        error
      })
      return res.status(404).json({
        error: {
          message: error.message,
          type: 'not_found',
          code: error.code ?? 'session_message_not_found'
        }
      })
    }

    logger.error('Error deleting session message', {
      error,
      agentId: req.params.agentId,
      sessionId: req.params.sessionId,
      messageId: Number(req.params.messageId)
    })
    return res.status(500).json({
      error: {
        message: 'Failed to delete session message',
        type: 'internal_error',
        code: 'session_message_delete_failed'
      }
    })
  }
}
