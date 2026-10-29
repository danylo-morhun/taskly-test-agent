import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodoEmptyState } from './TodoEmptyState'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

const firstTask = 'Add your first task'

it('invites creating the first task when there are no tasks', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  render(
    <TodoEmptyState hasTodos={false} disabled={false} onCreate={onCreate} />,
  )
  const heading = screen.getByRole('heading', { name: firstTask })
  expect(heading).toBeVisible()
  const hint = 'Write down what you need to do and get started.'
  expect(screen.getByText(hint)).toBeVisible()
  await user.click(screen.getByRole('button', { name: firstTask }))
  expect(onCreate).toHaveBeenCalledTimes(1)
})

it('disables the create button while busy', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  render(<TodoEmptyState hasTodos={false} disabled onCreate={onCreate} />)
  const button = screen.getByRole('button', { name: firstTask })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(onCreate).not.toHaveBeenCalled()
})

it('suggests changing filters when tasks exist but none match', () => {
  render(<TodoEmptyState hasTodos disabled={false} onCreate={vi.fn()} />)
  const heading = screen.getByRole('heading', { name: 'No matching tasks' })
  expect(heading).toBeVisible()
  const hint = 'Change the status filter or search to find your tasks.'
  expect(screen.getByText(hint)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
