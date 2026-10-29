import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { Todo, TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    initial,
    busy,
    error,
    onSubmit,
    onCancel,
  }: {
    initial?: TodoInput
    busy: boolean
    error: string | null
    onSubmit: (input: TodoInput) => Promise<void>
    onCancel: () => void
  }) => (
    <div>
      <p>Initial: {initial ? initial.title : 'none'}</p>
      <p>Form busy: {String(busy)}</p>
      <p>Form error: {error ?? 'none'}</p>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      <button onClick={onCancel}>Cancel form</button>
    </div>
  ),
}))
beforeEach(() => vi.clearAllMocks())

function mockMutations({
  create = vi.fn(),
  update = vi.fn(),
  createState = {},
  updateState = {},
}: {
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  createState?: { isPending?: boolean; error?: Error | null }
  updateState?: { isPending?: boolean; error?: Error | null }
} = {}) {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
    ...createState,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
    ...updateState,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  return { create, update }
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('starts a new task with an empty form', () => {
  mockMutations()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Initial: none')).toBeVisible()
  expect(screen.getByText('Form busy: false')).toBeVisible()
  expect(screen.getByText('Form error: none')).toBeVisible()
})

it('edits an existing task and reports saved changes', async () => {
  const user = userEvent.setup()
  const existing: Todo = { ...todoFixture, id: 12, title: 'Existing' }
  const { create, update } = mockMutations({
    update: vi.fn().mockResolvedValue(existing),
  })
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={existing}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(screen.getByText('Initial: Existing')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({ id: 12, input: todoFixture })
  expect(create).not.toHaveBeenCalled()
})

it('keeps the editor open when saving fails', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockRejectedValue(new Error('Server down'))
  mockMutations({ create })
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
})

it('shows the error of the create mutation for a new task', () => {
  mockMutations({
    createState: { error: new Error('Create failed') },
    updateState: { error: new Error('Update failed') },
  })
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Form error: Create failed')).toBeVisible()
})

it('shows the error of the update mutation for an existing task', () => {
  mockMutations({
    createState: { error: new Error('Create failed') },
    updateState: { error: new Error('Update failed') },
  })
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByText('Form error: Update failed')).toBeVisible()
})

it('ignores submissions while the page is busy', async () => {
  const user = userEvent.setup()
  const { create } = mockMutations()
  const onSaved = vi.fn()
  render(<TodoEditor todo="new" busy onClose={vi.fn()} onSaved={onSaved} />)
  expect(screen.getByText('Form busy: true')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('ignores submissions while its own mutation is pending', async () => {
  const user = userEvent.setup()
  const { update } = mockMutations({ updateState: { isPending: true } })
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )
  expect(screen.getByText('Form busy: true')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(update).not.toHaveBeenCalled()
})

it('is not blocked by the pending state of the other mutation', () => {
  mockMutations({ updateState: { isPending: true } })
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Form busy: false')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
})

it('closes from the drawer and from the form', async () => {
  const user = userEvent.setup()
  mockMutations()
  const onClose = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={onClose} onSaved={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Cancel form' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
