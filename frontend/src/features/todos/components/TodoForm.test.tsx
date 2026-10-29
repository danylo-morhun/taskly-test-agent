import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { TodoInput } from '../types'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })
})

describe('TodoForm states', () => {
  const titleError = 'The title must be at most 120 characters.'
  const descriptionError = 'The description must be at most 2000 characters.'
  const dateError = 'Enter a valid date.'

  interface FormOptions {
    initial?: TodoInput
    busy?: boolean
    error?: string | null
  }

  function renderForm(options: FormOptions = {}) {
    const { initial, busy = false, error = null } = options
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    render(
      <TodoForm
        initial={initial}
        onSubmit={onSubmit}
        onCancel={onCancel}
        busy={busy}
        error={error}
      />,
    )
    return { onSubmit, onCancel }
  }

  // Labels include the error text while errors are shown.
  const title = () => screen.getByLabelText(/^Task title/)
  const description = () => screen.getByLabelText(/^Description \(optional\)/)
  const dueDate = () => screen.getByLabelText(/^Due date \(optional\)/)
  const priority = () => screen.getByLabelText('Priority')
  const save = () => screen.getByRole('button', { name: 'Save task' })
  const cancel = () => screen.getByRole('button', { name: 'Cancel' })
  function setDueDate(value: string) {
    fireEvent.change(dueDate(), { target: { value } })
  }

  it('prefills the initial task and submits edits', async () => {
    const user = userEvent.setup()
    const initial = { ...todoFixture, priority: 'low' as const }
    const { onSubmit } = renderForm({
      initial: { ...initial, due_date: '2026-11-01' },
    })
    expect(title()).toHaveValue(todoFixture.title)
    expect(priority()).toHaveValue('low')
    expect(dueDate()).toHaveValue('2026-11-01')
    await user.type(description(), '  Slides  ')
    setDueDate('2026-12-24')
    await user.click(save())
    expect(onSubmit).toHaveBeenCalledWith({
      ...initial,
      description: 'Slides',
      due_date: '2026-12-24',
    })
  })

  it('submits a cleared due date as null', async () => {
    const user = userEvent.setup()
    const initial = { ...todoFixture, due_date: '2026-11-01' }
    const { onSubmit } = renderForm({ initial })
    setDueDate('')
    expect(dueDate()).toHaveValue('')
    await user.click(save())
    expect(onSubmit).toHaveBeenCalledWith({ ...initial, due_date: null })
  })

  it('shows every validation error and clears them once fixed', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      initial: {
        ...todoFixture,
        title: 'a'.repeat(121),
        description: 'b'.repeat(2001),
        due_date: '2026-02-30',
      },
    })
    await user.click(save())
    expect(screen.getByText(titleError)).toBeVisible()
    expect(screen.getByText(descriptionError)).toBeVisible()
    expect(screen.getByText(dateError)).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(title())
    await user.type(title(), 'Short')
    await user.clear(description())
    setDueDate('2026-02-28')
    await user.click(save())
    expect(screen.queryByText(titleError)).not.toBeInTheDocument()
    expect(screen.queryByText(descriptionError)).not.toBeInTheDocument()
    expect(screen.queryByText(dateError)).not.toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      ...todoFixture,
      title: 'Short',
      description: '',
      due_date: '2026-02-28',
    })
  })

  it('prevents the native form submission', () => {
    renderForm()
    const form = save().closest('form')
    expect(form).not.toBeNull()
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.submit(form as HTMLFormElement)).toBe(false)
  })

  it('starts empty and cancels without submitting', async () => {
    const user = userEvent.setup()
    const { onSubmit, onCancel } = renderForm()
    expect(title()).toHaveValue('')
    expect(priority()).toHaveValue('medium')
    expect(dueDate()).toHaveValue('')
    await user.click(cancel())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('locks the form and shows progress while saving', () => {
    renderForm({ busy: true })
    expect(screen.getByRole('group')).toBeDisabled()
    const saving = screen.getByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
    expect(cancel()).toBeDisabled()
    const idleSave = screen.queryByRole('button', { name: 'Save task' })
    expect(idleSave).not.toBeInTheDocument()
  })

  it('keeps the form enabled when idle', () => {
    renderForm()
    expect(screen.getByRole('group')).toBeEnabled()
    expect(save()).toBeEnabled()
    expect(cancel()).toBeEnabled()
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
  })

  it('shows a server error', () => {
    renderForm({ error: 'Task not found.' })
    expect(screen.getByTestId('alert')).toHaveTextContent('Task not found.')
  })

  it('offers every priority option', () => {
    renderForm()
    const options = screen.getAllByRole('option')
    const pairs = options.map((o) => [o.getAttribute('value'), o.textContent])
    expect(pairs).toEqual([
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ])
  })
})
