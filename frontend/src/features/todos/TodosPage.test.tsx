import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'
import type { Todo } from './types'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    disabled,
    onCreate,
  }: {
    disabled: boolean
    onCreate: () => void
  }) => (
    <div>
      <h1>Tasks</h1>
      <button disabled={disabled} onClick={onCreate}>
        Header create
      </button>
    </div>
  ),
}))
vi.mock('./components/TodoFilters', () => ({
  TodoFilters: (props: {
    filter: string
    search: string
    sort: string
    onFilterChange: (v: string) => void
    onSearchChange: (v: string) => void
    onSortChange: (v: string) => void
  }) => (
    <div>
      <p>
        Filters: {props.filter}/{props.search}/{props.sort}
      </p>
      <button onClick={() => props.onFilterChange('active')}>
        Filter active
      </button>
      <button onClick={() => props.onSearchChange('demo')}>Search demo</button>
      <button onClick={() => props.onSortChange('due')}>Sort due</button>
    </div>
  ),
}))
vi.mock('./components/TodoList', () => ({
  TodoList: (props: {
    todos: Todo[]
    hasTodos: boolean
    loading: boolean
    failed: boolean
    busy: boolean
    onCreate: () => void
    onToggle: (todo: Todo) => void
    onEdit: (todo: Todo) => void
    onDelete: (todo: Todo) => void
  }) => (
    <div>
      <p>Task list</p>
      <p>
        List: {props.todos.map((t) => t.id).join(',') || 'empty'}; has=
        {String(props.hasTodos)}; loading={String(props.loading)}; failed=
        {String(props.failed)}; busy={String(props.busy)}
      </p>
      <button onClick={props.onCreate}>List create</button>
      {props.todos.map((todo) => (
        <div key={todo.id}>
          <button onClick={() => props.onToggle(todo)}>Toggle {todo.id}</button>
          <button onClick={() => props.onEdit(todo)}>Edit {todo.id}</button>
          <button onClick={() => props.onDelete(todo)}>Delete {todo.id}</button>
        </div>
      ))}
    </div>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: ({
    todo,
    busy,
    onClose,
    onSaved,
  }: {
    todo: Todo | 'new'
    busy: boolean
    onClose: () => void
    onSaved: (message: string) => void
  }) => (
    <div role="dialog" aria-label="Editor">
      <p>
        Editing: {todo === 'new' ? 'new' : todo.id}; busy={String(busy)}
      </p>
      <button onClick={onClose}>Close editor</button>
      <button onClick={() => onSaved('Changes saved.')}>Save editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: ({
    todo,
    busy,
    onClose,
    onDeleted,
  }: {
    todo: Todo
    busy: boolean
    onClose: () => void
    onDeleted: () => void
  }) => (
    <div role="dialog" aria-label="Delete">
      <p>
        Deleting: {todo.id}; busy={String(busy)}
      </p>
      <button onClick={onClose}>Close delete</button>
      <button onClick={onDeleted}>Confirm delete</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: { message: string }) => (
    <p>Notice: {message || 'none'}</p>
  ),
}))
beforeEach(() => vi.clearAllMocks())

const done: Todo = { ...todoFixture, id: 8, completed: true }

function setup({
  query = {},
  mutation = {},
  busy = false,
  message = '',
  visible = [todoFixture, done],
}: {
  query?: Record<string, unknown>
  mutation?: Record<string, unknown>
  busy?: boolean
  message?: string
  visible?: Todo[]
} = {}) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  const mutateAsync = vi.fn()
  const notify = vi.fn()
  const filters = {
    filter: 'all' as const,
    search: '',
    sort: 'newest' as const,
    visible,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  }
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [todoFixture, done],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch,
    ...query,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync,
    ...mutation,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message, notify })
  vi.mocked(useTodoFilters).mockReturnValue(filters)
  render(<TodosPage />)
  return { refetch, reset, mutateAsync, notify, filters }
}

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('passes loaded tasks through the filters to the list', () => {
  setup({ visible: [done] })
  expect(useTodoFilters).toHaveBeenCalledWith([todoFixture, done])
  expect(
    screen.getByText(
      'List: 8; has=true; loading=false; failed=false; busy=false',
    ),
  ).toBeVisible()
  expect(screen.getByText('Filters: all//newest')).toBeVisible()
  expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('treats missing query data as an empty task list', () => {
  setup({ query: { data: undefined, isPending: true }, visible: [] })
  expect(useTodoFilters).toHaveBeenCalledWith([])
  expect(
    screen.getByText(
      'List: empty; has=false; loading=true; failed=false; busy=false',
    ),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Header create' })).toBeDisabled()
})

it('reports a query error state to the list', () => {
  setup({ query: { isError: true, error: new Error('Offline') } })
  expect(screen.getByText(/failed=true/)).toBeVisible()
})

it('forwards filter changes to the filter state', async () => {
  const user = userEvent.setup()
  const { filters } = setup()
  await user.click(screen.getByRole('button', { name: 'Filter active' }))
  await user.click(screen.getByRole('button', { name: 'Search demo' }))
  await user.click(screen.getByRole('button', { name: 'Sort due' }))
  expect(filters.setFilter).toHaveBeenCalledWith('active')
  expect(filters.setSearch).toHaveBeenCalledWith('demo')
  expect(filters.setSort).toHaveBeenCalledWith('due')
})

it('disables creation and passes busy state while a mutation runs', () => {
  setup({ busy: true })
  expect(screen.getByRole('button', { name: 'Header create' })).toBeDisabled()
  expect(screen.getByText(/busy=true/)).toBeVisible()
})

it('enables creation when loaded and idle', () => {
  setup()
  expect(screen.getByRole('button', { name: 'Header create' })).toBeEnabled()
})

it('completes an active task and celebrates', async () => {
  const user = userEvent.setup()
  const { mutateAsync, notify } = setup()
  mutateAsync.mockResolvedValue({ ...todoFixture, completed: true })
  await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: 7,
    input: { completed: true },
  })
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('Another task complete. Well done!'),
  )
})

it('reopens a completed task and confirms it is active', async () => {
  const user = userEvent.setup()
  const { mutateAsync, notify } = setup()
  mutateAsync.mockResolvedValue({ ...done, completed: false })
  await user.click(screen.getByRole('button', { name: 'Toggle 8' }))
  expect(mutateAsync).toHaveBeenCalledWith({
    id: 8,
    input: { completed: false },
  })
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith('Task marked as active.'),
  )
})

it('does not notify when toggling fails', async () => {
  const user = userEvent.setup()
  const { mutateAsync, notify } = setup()
  mutateAsync.mockRejectedValue(new Error('Conflict'))
  await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
  expect(notify).not.toHaveBeenCalled()
})

it('ignores toggles while busy', async () => {
  const user = userEvent.setup()
  const { mutateAsync } = setup({ busy: true })
  await user.click(screen.getByRole('button', { name: 'Toggle 7' }))
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('shows a toggle error in preference to a query error', () => {
  setup({
    query: { error: new Error('Query failed') },
    mutation: { error: new Error('Toggle failed') },
  })
  expect(screen.getByTestId('alert')).toHaveTextContent('Toggle failed')
  expect(screen.getByTestId('alert')).not.toHaveTextContent('Query failed')
})

it('disables retry while refetching or busy', () => {
  setup({ query: { error: new Error('x'), isFetching: true } })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
})

it('disables retry while a mutation runs', () => {
  setup({ query: { error: new Error('x') }, busy: true })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
})

it('enables retry when idle', () => {
  setup({ query: { error: new Error('x') } })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
})

it('opens the editor for a new task from the header and the list', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'Header create' }))
  expect(screen.getByText('Editing: new; busy=false')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(
    screen.queryByRole('dialog', { name: 'Editor' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'List create' }))
  expect(screen.getByText('Editing: new; busy=false')).toBeVisible()
})

it('edits a task, then closes the editor and shows the saved notice', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(screen.getByRole('button', { name: 'Edit 8' }))
  expect(screen.getByText('Editing: 8; busy=false')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save editor' }))
  expect(notify).toHaveBeenCalledWith('Changes saved.')
  expect(
    screen.queryByRole('dialog', { name: 'Editor' }),
  ).not.toBeInTheDocument()
})

it('passes the busy state to the editor and delete dialog', async () => {
  const user = userEvent.setup()
  setup({ busy: true })
  await user.click(screen.getByRole('button', { name: 'Edit 7' }))
  expect(screen.getByText('Editing: 7; busy=true')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Delete 7' }))
  expect(screen.getByText('Deleting: 7; busy=true')).toBeVisible()
})

it('confirms deletion, closes the dialog and notifies', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(screen.getByRole('button', { name: 'Delete 8' }))
  expect(screen.getByText('Deleting: 8; busy=false')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
  expect(notify).toHaveBeenCalledWith('Task deleted.')
  expect(
    screen.queryByRole('dialog', { name: 'Delete' }),
  ).not.toBeInTheDocument()
})

it('closes the delete dialog without notifying', async () => {
  const user = userEvent.setup()
  const { notify } = setup()
  await user.click(screen.getByRole('button', { name: 'Delete 7' }))
  await user.click(screen.getByRole('button', { name: 'Close delete' }))
  expect(
    screen.queryByRole('dialog', { name: 'Delete' }),
  ).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it('shows the current notice message', () => {
  setup({ message: 'Task deleted.' })
  expect(screen.getByText('Notice: Task deleted.')).toBeVisible()
})
