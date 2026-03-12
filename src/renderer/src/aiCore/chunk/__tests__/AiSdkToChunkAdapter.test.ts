import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/KnowledgeService', () => ({
  processKnowledgeReferences: vi.fn()
}))

import { type Chunk, ChunkType } from '@renderer/types/chunk'

import { AiSdkToChunkAdapter } from '../AiSdkToChunkAdapter'

describe('AiSdkToChunkAdapter', () => {
  it('accumulates Codex text deltas before text completion', async () => {
    const seen: Chunk[] = []
    const adapter = new AiSdkToChunkAdapter((chunk) => seen.push(chunk), [], false, false)

    const fullStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'msg-1', providerMetadata: { codex: { itemId: 'msg-1' } } })
        controller.enqueue({
          type: 'text-delta',
          id: 'msg-1',
          text: '我来直接',
          providerMetadata: { codex: { itemId: 'msg-1' } }
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'msg-1',
          text: '创建这个文件',
          providerMetadata: { codex: { itemId: 'msg-1' } }
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'msg-1',
          text: '。',
          providerMetadata: { codex: { itemId: 'msg-1' } }
        })
        controller.enqueue({ type: 'text-end', id: 'msg-1', providerMetadata: { codex: { itemId: 'msg-1' } } })
        controller.close()
      }
    })

    await adapter.processStream({
      fullStream,
      text: Promise.resolve('')
    })

    expect(seen).toContainEqual({ type: ChunkType.TEXT_START })
    expect(seen).toContainEqual({
      type: ChunkType.TEXT_DELTA,
      text: '我来直接创建这个文件。',
      providerMetadata: undefined
    })
    expect(seen.at(-1)).toEqual({
      type: ChunkType.TEXT_COMPLETE,
      text: '我来直接创建这个文件。',
      providerMetadata: undefined
    })
  })
})
