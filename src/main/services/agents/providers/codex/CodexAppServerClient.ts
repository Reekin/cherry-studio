import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { loggerService } from '@logger'
import type { GetAgentSessionResponse } from '@types'

import { getBinaryPath } from '../../../../utils/process'
import getLoginShellEnvironment from '../../../../utils/shell-env'
import type { AgentThinkingOptions } from '../../interfaces/AgentStreamInterface'
import type { CodexAppServerEvent } from './types'

const logger = loggerService.withContext('CodexAppServerClient')

type JsonRpcRequestMessage = {
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponseMessage = {
  id: number
  result?: unknown
  error?: {
    message?: string
  }
}

type JsonRpcNotificationMessage = {
  method: string
  params?: unknown
}

type PendingRequest = {
  method: string
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
}

type RunTurnOptions = {
  prompt: string
  session: GetAgentSessionResponse
  lastThreadId?: string
  thinkingOptions?: AgentThinkingOptions
  signal: AbortSignal
}

type RunTurnResult = {
  threadId: string
  events: AsyncIterable<CodexAppServerEvent>
}

type CodexApprovalPolicy = 'never' | 'on-request'
type CodexSandboxMode = 'danger-full-access' | 'workspace-write' | 'read-only'

const isResponseMessage = (value: unknown): value is JsonRpcResponseMessage => {
  return !!value && typeof value === 'object' && 'id' in value
}

const isNotificationMessage = (value: unknown): value is JsonRpcNotificationMessage => {
  return !!value && typeof value === 'object' && 'method' in value
}

const toRecord = (value: unknown): Record<string, any> | null => {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

type CodexEventMappingContext = {
  threadId?: string
  turnId?: string
}

export function codexNotificationToAppServerEvent(
  notification: JsonRpcNotificationMessage,
  context: CodexEventMappingContext = {}
): CodexAppServerEvent | null {
  const params = toRecord(notification.params)
  if (!params) {
    return null
  }

  switch (notification.method) {
    case 'turn/started':
      return {
        type: 'turn.started',
        threadId: params.threadId,
        turn: params.turn
      }
    case 'turn/completed':
      return {
        type: 'turn.completed',
        threadId: params.threadId,
        turn: params.turn
      }
    case 'item/started':
      return {
        type: 'item.started',
        threadId: params.threadId,
        turnId: params.turnId,
        item: params.item
      }
    case 'item/completed':
      return {
        type: 'item.completed',
        threadId: params.threadId,
        turnId: params.turnId,
        item: params.item
      }
    case 'item/agentMessage/delta':
      return {
        type: 'agent.message.delta',
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        delta: params.delta
      }
    case 'item/plan/delta':
      return {
        type: 'plan.delta',
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        delta: params.delta
      }
    case 'item/reasoning/summaryTextDelta':
      return {
        type: 'reasoning.summary.delta',
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        delta: params.delta,
        summaryIndex: params.summaryIndex
      }
    case 'thread/tokenUsage/updated':
      return {
        type: 'thread.token.usage.updated',
        threadId: params.threadId,
        turnId: params.turnId,
        tokenUsage: params.tokenUsage
      }
    case 'error':
      return {
        type: 'error',
        threadId: params.threadId,
        turnId: params.turnId,
        error: params.error,
        willRetry: Boolean(params.willRetry)
      }
    case 'codex/event/task_complete': {
      const msg = toRecord(params.msg)
      const turnId = typeof msg?.turn_id === 'string' ? msg.turn_id : context.turnId
      const threadId =
        typeof params.conversationId === 'string'
          ? params.conversationId
          : typeof context.threadId === 'string'
            ? context.threadId
            : undefined

      if (!turnId || !threadId) {
        return null
      }

      return {
        type: 'turn.completed',
        threadId,
        turn: {
          id: turnId,
          items: [],
          status: 'completed',
          error: null
        }
      }
    }
    default:
      return null
  }
}

const isAbortError = (value: unknown): value is Error => {
  return value instanceof Error && value.name === 'AbortError'
}

const createAbortError = (message = 'Codex invocation aborted'): Error => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void
    reject: (reason?: unknown) => void
  }> = []
  private closed = false
  private failure: unknown

  push(value: T): void {
    if (this.closed) {
      return
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }

    this.values.push(value)
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true })
    }
  }

  fail(error: unknown): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.failure = error
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error)
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      const value = this.values.shift()!
      return { value, done: false }
    }

    if (this.failure) {
      throw this.failure
    }

    if (this.closed) {
      return { value: undefined, done: true }
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next()
    }
  }
}

class CodexJsonRpcProcess {
  private readonly pending = new Map<number, PendingRequest>()
  private readonly notificationQueue = new AsyncQueue<JsonRpcNotificationMessage>()
  private readonly stderrLines: string[] = []
  private nextId = 1
  private closed = false

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')

    const lineReader = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity
    })

    lineReader.on('line', (line) => {
      this.handleStdoutLine(line)
    })

    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      if (text.trim()) {
        this.stderrLines.push(text.trim())
      }
    })

    this.child.on('error', (error) => {
      this.failAll(error)
    })

    this.child.on('exit', (code, signal) => {
      if (this.closed) {
        return
      }

      const stderrTail = this.stderrLines.slice(-10).join('\n')
      const details = stderrTail ? `\n${stderrTail}` : ''
      const error = new Error(
        `Codex app-server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})${details}`
      )
      this.failAll(error)
    })
  }

  get notifications(): AsyncIterable<JsonRpcNotificationMessage> {
    return this.notificationQueue
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve,
        reject
      })
    })

    this.write({
      id,
      method,
      params
    })

    return response
  }

  notify(method: string, params?: unknown): void {
    this.write({
      method,
      params
    })
  }

  dispose(): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.notificationQueue.close()

    if (!this.child.killed) {
      this.child.kill('SIGTERM')
    }
  }

  private write(message: Omit<JsonRpcRequestMessage, 'id'> | JsonRpcRequestMessage): void {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error('Codex app-server process is not writable')
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch (error) {
      logger.warn('Failed to parse Codex JSON-RPC line', {
        line: trimmed,
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    if (isResponseMessage(message)) {
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }

      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `Codex request failed: ${pending.method}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (isNotificationMessage(message)) {
      this.notificationQueue.push(message)
    }
  }

  private failAll(error: unknown): void {
    if (this.closed) {
      return
    }

    this.closed = true
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
    this.notificationQueue.fail(error)
  }
}

export class CodexAppServerClient {
  async runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
    const cwd = options.session.accessible_paths[0]
    if (!cwd) {
      throw new Error('No accessible paths defined for the Codex session')
    }

    if (options.signal.aborted) {
      throw createAbortError()
    }

    const loginShellEnv = await getLoginShellEnvironment()
    const codexExecutable = await getBinaryPath('codex')
    const child = spawn(codexExecutable, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env: {
        ...process.env,
        ...loginShellEnv
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const rpc = new CodexJsonRpcProcess(child)
    const eventQueue = new AsyncQueue<CodexAppServerEvent>()
    const cleanup = () => {
      options.signal.removeEventListener('abort', abortHandler)
      eventQueue.close()
      rpc.dispose()
    }

    const abortHandler = () => {
      options.signal.removeEventListener('abort', abortHandler)
      const abortError = createAbortError()
      eventQueue.fail(abortError)
      rpc.dispose()
    }

    options.signal.addEventListener('abort', abortHandler, { once: true })

    try {
      await rpc.request('initialize', {
        clientInfo: {
          name: 'cherry_studio',
          title: 'Cherry Studio',
          version: '0.0.0'
        },
        capabilities: {
          experimentalApi: true
        }
      })
      rpc.notify('initialized', {})

      const developerInstructions =
        typeof options.session.instructions === 'string' && options.session.instructions.trim().length > 0
          ? options.session.instructions
          : null
      const executionPolicy = this.resolveExecutionPolicy(options.session)

      let threadId = options.lastThreadId?.trim() ?? ''
      if (threadId) {
        const resumed = (await rpc.request('thread/resume', {
          threadId,
          cwd,
          approvalPolicy: executionPolicy.approvalPolicy,
          sandbox: executionPolicy.sandboxMode,
          developerInstructions,
          persistExtendedHistory: true
        })) as { thread?: { id?: string } }

        threadId = resumed.thread?.id ?? threadId
      } else {
        const started = (await rpc.request('thread/start', {
          cwd,
          approvalPolicy: executionPolicy.approvalPolicy,
          sandbox: executionPolicy.sandboxMode,
          developerInstructions,
          experimentalRawEvents: false,
          persistExtendedHistory: true
        })) as { thread?: { id?: string } }

        threadId = started.thread?.id ?? ''
      }

      if (!threadId) {
        throw new Error('Codex app-server did not return a thread id')
      }

      const turnStarted = (await rpc.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: options.prompt,
            text_elements: []
          }
        ],
        cwd,
        approvalPolicy: executionPolicy.approvalPolicy,
        sandboxPolicy: executionPolicy.turnSandboxPolicy,
        ...(options.thinkingOptions?.effort ? { effort: options.thinkingOptions.effort } : {})
      })) as { turn?: { id?: string } }

      const turnId = turnStarted.turn?.id ?? ''
      void this.forwardNotifications(rpc.notifications, eventQueue, cleanup, { threadId, turnId })

      return {
        threadId,
        events: eventQueue
      }
    } catch (error) {
      rpc.dispose()
      options.signal.removeEventListener('abort', abortHandler)
      if (isAbortError(error)) {
        throw error
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private async forwardNotifications(
    notifications: AsyncIterable<JsonRpcNotificationMessage>,
    eventQueue: AsyncQueue<CodexAppServerEvent>,
    cleanup: () => void,
    context: CodexEventMappingContext
  ): Promise<void> {
    try {
      for await (const notification of notifications) {
        const event = codexNotificationToAppServerEvent(notification, context)
        if (!event) {
          continue
        }

        eventQueue.push(event)
        if (event.type === 'turn.completed') {
          cleanup()
          break
        }
      }
    } catch (error) {
      eventQueue.fail(error)
    }
  }

  private resolveExecutionPolicy(session: GetAgentSessionResponse): {
    approvalPolicy: CodexApprovalPolicy
    sandboxMode: CodexSandboxMode
    turnSandboxPolicy:
      | { type: 'dangerFullAccess' }
      | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean }
      | { type: 'readOnly'; networkAccess: boolean; access: { type: 'fullAccess' } }
  } {
    const permissionMode = session.configuration?.permission_mode ?? 'default'
    const writableRoots = Array.isArray(session.accessible_paths) ? session.accessible_paths.filter(Boolean) : []

    if (permissionMode === 'plan') {
      return {
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only',
        turnSandboxPolicy: {
          type: 'readOnly',
          networkAccess: false,
          access: {
            type: 'fullAccess'
          }
        }
      }
    }

    if (permissionMode === 'bypassPermissions') {
      return {
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        turnSandboxPolicy: {
          type: 'dangerFullAccess'
        }
      }
    }

    return {
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      turnSandboxPolicy: {
        type: 'workspaceWrite',
        networkAccess: false,
        writableRoots
      }
    }
  }
}
