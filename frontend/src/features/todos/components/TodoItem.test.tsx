import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Badge, Text } from '../../../design-system'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

describe('TodoItem details', () => {
  afterEach(() => vi.useRealTimers())

  function renderItem(todo: Todo, busy = false) {
    const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }
    render(<TodoItem todo={todo} busy={busy} {...handlers} />)
    return handlers
  }

  function badgeVariants() {
    return vi.mocked(Badge).mock.calls.map(([props]) => props.variant)
  }

  it('shows the id, description and no due date by default', () => {
    renderItem({ ...todoFixture, description: 'Slides and notes' })
    expect(screen.getByText(`#${todoFixture.id}`)).toBeVisible()
    expect(screen.getByText('Slides and notes')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['info'])
  })

  it('omits the description text when empty', () => {
    renderItem(todoFixture)
    expect(
      vi.mocked(Text).mock.calls.filter(([props]) => props.preserveWhitespace),
    ).toHaveLength(0)
  })

  it('shows a completed task with a mark-as-active toggle', async () => {
    const user = userEvent.setup()
    const done = { ...todoFixture, completed: true, priority: 'high' as const }
    const { onToggle, onEdit, onDelete } = renderItem(done)
    expect(screen.getByText('Completed')).toBeVisible()
    expect(screen.queryByText('To do')).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['success'])
    expect(screen.getByText('High')).toBeVisible()
    const checkbox = screen.getByRole('checkbox', {
      name: `Mark as active: ${done.title}`,
    })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('labels the toggle of an active task as complete', () => {
    renderItem(todoFixture)
    expect(
      screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
    ).not.toBeChecked()
  })

  it('forwards delete requests', async () => {
    const user = userEvent.setup()
    const { onDelete, onToggle, onEdit } = renderItem(todoFixture)
    await user.click(
      screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
    )
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('disables every action while busy', () => {
    renderItem(todoFixture, true)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
    ).toBeDisabled()
  })

  it('enables every action when idle', () => {
    renderItem(todoFixture)
    expect(screen.getByRole('checkbox')).toBeEnabled()
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeEnabled()
    }
  })

  it('marks a past due date of an open task as overdue', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    renderItem({ ...todoFixture, due_date: '2026-10-14' })
    expect(screen.getByText('14 Oct 2026 · overdue')).toBeVisible()
    expect(badgeVariants()).toEqual(['info', 'warning'])
  })

  it('does not mark a past due date of a completed task as overdue', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    renderItem({ ...todoFixture, completed: true, due_date: '2026-10-14' })
    expect(screen.getByText('14 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['success', 'neutral'])
  })

  it('shows an upcoming due date without the overdue marker', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    renderItem({ ...todoFixture, due_date: '2026-10-20' })
    expect(screen.getByText('20 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    expect(badgeVariants()).toEqual(['info', 'neutral'])
  })
})
