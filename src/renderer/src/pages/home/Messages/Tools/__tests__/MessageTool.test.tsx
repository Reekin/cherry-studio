import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MessageTool from '../MessageTool'

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({
    id: 'test-assistant',
    name: 'Test Assistant',
    settings: {}
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'test-topic',
    assistantId: 'test-assistant',
    createdAt: new Date().toISOString()
  }))
}))

const mockUseAppSelector = vi.fn()
const mockUseTranslation = vi.fn()

vi.mock('@renderer/store', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => mockUseAppSelector(selector)
}))

vi.mock('@renderer/store/toolPermissions', () => ({
  selectPendingPermission: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('antd', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Collapse: ({ items, defaultActiveKey, className }: any) => (
      <div data-testid="collapse" className={className} data-active-key={JSON.stringify(defaultActiveKey)}>
        {items?.map((item: any) => (
          <div key={item.key} data-testid={`collapse-item-${item.key}`}>
            <div data-testid={`collapse-header-${item.key}`}>{item.label}</div>
            <div data-testid={`collapse-content-${item.key}`}>{item.children}</div>
          </div>
        ))}
      </div>
    ),
    Tag: ({ children, className }: any) => (
      <span data-testid="tag" className={className}>
        {children}
      </span>
    ),
    Popover: ({ children }: any) => <>{children}</>,
    Card: ({ children, className }: any) => (
      <div data-testid="card" className={className}>
        {children}
      </div>
    ),
    Button: ({ children, onClick, type, size, icon, disabled }: any) => (
      <button
        type="button"
        data-testid="button"
        onClick={onClick}
        data-type={type}
        data-size={size}
        disabled={disabled}>
        {icon}
        {children}
      </button>
    )
  }
})

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Bot: () => <span data-testid="bot-icon" />,
    Check: () => <span data-testid="check-icon" />,
    Circle: () => <span data-testid="circle-icon" />,
    Clock: () => <span data-testid="clock-icon" />,
    DoorOpen: () => <span data-testid="door-open-icon" />,
    FileEdit: () => <span data-testid="file-edit-icon" />,
    FileSearch: () => <span data-testid="file-search-icon" />,
    FileText: () => <span data-testid="file-text-icon" />,
    FolderSearch: () => <span data-testid="folder-search-icon" />,
    Globe: () => <span data-testid="globe-icon" />,
    ImageIcon: () => <span data-testid="image-icon" />,
    ListTodo: () => <span data-testid="list-todo-icon" />,
    NotebookPen: () => <span data-testid="notebook-pen-icon" />,
    PencilRuler: () => <span data-testid="pencil-ruler-icon" />,
    Search: () => <span data-testid="search-icon" />,
    Terminal: () => <span data-testid="terminal-icon" />,
    TriangleAlert: () => <span data-testid="triangle-alert-icon" />,
    Wrench: () => <span data-testid="wrench-icon" />,
    X: () => <span data-testid="x-icon" />
  }
})

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <span data-testid="loading-icon" />
}))

vi.mock('../ToolPermissionRequestCard', () => ({
  default: () => <div data-testid="permission-card">Permission Required</div>
}))

vi.mock('../MessageKnowledgeSearch', () => ({
  MessageKnowledgeSearchToolTitle: () => <div data-testid="knowledge-search-tool" />
}))

vi.mock('../MessageMemorySearch', () => ({
  MessageMemorySearchToolTitle: () => <div data-testid="memory-search-tool" />
}))

vi.mock('../MessageWebSearch', () => ({
  MessageWebSearchToolTitle: () => <div data-testid="web-search-tool" />
}))

describe('MessageTool', () => {
  const mockTranslations: Record<string, string> = {
    'message.tools.labels.mcpServerTool': 'MCP Server Tool',
    'message.tools.labels.tool': 'Tool',
    'message.tools.sections.input': 'Input',
    'message.tools.sections.output': 'Output',
    'message.tools.noData': 'No data',
    'message.tools.status.done': 'Done'
  }

  beforeEach(() => {
    mockUseAppSelector.mockReturnValue(null)
    mockUseTranslation.mockReturnValue({
      t: (key: string, fallback?: string) => mockTranslations[key] ?? fallback ?? key
    })
  })

  it('renders unknown provider tools via the generic agent tool fallback', () => {
    const block: ToolMessageBlock = {
      id: 'block-1',
      messageId: 'message-1',
      type: MessageBlockType.TOOL,
      createdAt: new Date().toISOString(),
      status: MessageBlockStatus.SUCCESS,
      toolId: 'file-1',
      metadata: {
        rawMcpToolResponse: {
          id: 'tool-1',
          tool: {
            id: 'file_change',
            name: 'file_change',
            type: 'provider',
            description: 'File change'
          },
          arguments: {
            changes: [{ path: '/tmp/ffff.txt' }]
          },
          response: {
            status: 'completed',
            changes: [{ path: '/tmp/ffff.txt' }]
          },
          status: 'done',
          toolCallId: 'call-1'
        }
      }
    }

    render(<MessageTool block={block} />)

    expect(screen.getByText('file_change')).toBeInTheDocument()
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getAllByText(/\[\{"path":"\/tmp\/ffff\.txt"\}\]/)).toHaveLength(2)
  })
})
