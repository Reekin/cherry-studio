import { describe, expect, it } from 'vitest'

import { codexNotificationToAppServerEvent } from '../CodexAppServerClient'

describe('codexNotificationToAppServerEvent', () => {
  it('maps task_complete into a synthetic completed turn event', () => {
    const event = codexNotificationToAppServerEvent(
      {
        method: 'codex/event/task_complete',
        params: {
          id: 'turn-1',
          conversationId: 'thread-1',
          msg: {
            type: 'task_complete',
            turn_id: 'turn-1'
          }
        }
      },
      {
        threadId: 'thread-fallback',
        turnId: 'turn-fallback'
      }
    )

    expect(event).toEqual({
      type: 'turn.completed',
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        items: [],
        status: 'completed',
        error: null
      }
    })
  })
})
