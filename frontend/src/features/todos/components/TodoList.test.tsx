import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({
    hasTodos,
    disabled,
    onCreate,
  }: {
    hasTodos: boolean
    disabled: boolean
    onCreate: () => void
  }) => (
    <div>
      <p>Empty task list</p>
      <p>{hasTodos ? 'Has tasks' : 'No tasks'}</p>
      <button disabled={disabled} onClick={onCreate}>
        Create from empty state
      </button>
    </div>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    busy,
    onToggle,
    onEdit,
    onDelete,
  }: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      Task {todo.title}
      {busy && ' (busy)'}
      <button onClick={onToggle}>Toggle {todo.id}</button>
      <button onClick={onEdit}>Edit {todo.id}</button>
      <button onClick={onDelete}>Delete {todo.id}</button>
    </li>
  ),
}))
beforeEach(() => vi.clearAllMocks())

function setup(overrides: Partial<Parameters<typeof TodoList>[0]> = {}) {
  const props = {
    todos: [],
    hasTodos: false,
    loading: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<TodoList {...props} />)
  return props
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('labels the task list region', () => {
  setup()
  expect(screen.getByRole('region', { name: 'Task list' })).toBeVisible()
})

it('shows an unavailable message when loading failed and nothing is cached', () => {
  setup({ failed: true })
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.getByText('Try again to load your tasks.')).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('keeps showing cached tasks when a refetch failed', () => {
  setup({ failed: true, hasTodos: true, todos: [todoFixture] })
  expect(
    screen.queryByText('The task list is temporarily unavailable'),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('listitem')).toHaveTextContent(
    `Task ${todoFixture.title}`,
  )
})

it('renders one item per task and forwards actions with that task', async () => {
  const user = userEvent.setup()
  const second: Todo = { ...todoFixture, id: 8, title: 'Review' }
  const props = setup({ todos: [todoFixture, second], hasTodos: true })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Toggle 8' }))
  expect(props.onToggle).toHaveBeenCalledWith(second)
  await user.click(screen.getByRole('button', { name: 'Edit 7' }))
  expect(props.onEdit).toHaveBeenCalledWith(todoFixture)
  await user.click(screen.getByRole('button', { name: 'Delete 8' }))
  expect(props.onDelete).toHaveBeenCalledWith(second)
  expect(props.onToggle).toHaveBeenCalledTimes(1)
  expect(props.onEdit).toHaveBeenCalledTimes(1)
  expect(props.onDelete).toHaveBeenCalledTimes(1)
})

it('passes the busy state to each item', () => {
  setup({ todos: [todoFixture], hasTodos: true, busy: true })
  expect(screen.getByRole('listitem')).toHaveTextContent('(busy)')
})

it('passes filter context, busy state and create callback to the empty state', async () => {
  const user = userEvent.setup()
  const props = setup({ hasTodos: true })
  expect(screen.getByText('Has tasks')).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Create from empty state' }),
  )
  expect(props.onCreate).toHaveBeenCalledTimes(1)
})

it('disables the empty state create action while busy', () => {
  setup({ busy: true })
  expect(screen.getByText('No tasks')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Create from empty state' }),
  ).toBeDisabled()
})
