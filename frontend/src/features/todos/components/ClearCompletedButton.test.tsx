import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ClearCompletedButton } from './ClearCompletedButton'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('renders nothing when there are no completed tasks', () => {
  render(<ClearCompletedButton count={0} disabled={false} onClear={vi.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('shows the completed count and clears on click', async () => {
  const user = userEvent.setup()
  const onClear = vi.fn()
  render(<ClearCompletedButton count={3} disabled={false} onClear={onClear} />)
  const button = screen.getByRole('button', { name: 'Clear completed (3)' })
  expect(button).toBeEnabled()
  await user.click(button)
  expect(onClear).toHaveBeenCalledTimes(1)
})

it('renders for a single completed task', () => {
  render(<ClearCompletedButton count={1} disabled={false} onClear={vi.fn()} />)
  expect(
    screen.getByRole('button', { name: 'Clear completed (1)' }),
  ).toBeVisible()
})

it('blocks clearing while disabled', async () => {
  const user = userEvent.setup()
  const onClear = vi.fn()
  render(<ClearCompletedButton count={2} disabled onClear={onClear} />)
  const button = screen.getByRole('button', { name: 'Clear completed (2)' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(onClear).not.toHaveBeenCalled()
})
