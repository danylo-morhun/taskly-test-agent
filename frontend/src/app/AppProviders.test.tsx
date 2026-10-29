import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme } from 'styled-components'
import { beforeEach, expect, it, vi } from 'vitest'
import { GlobalStyles, theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { AppProviders } from './AppProviders'

vi.mock('../design-system', () => import('../design-system/mocks'))
beforeEach(() => vi.clearAllMocks())

let seen: { client: QueryClient; theme: unknown } | null = null
function Probe() {
  seen = { client: useQueryClient(), theme: useTheme() }
  return <p>Probe content</p>
}

it('provides the given query client, the theme and global styles', () => {
  const client = new QueryClient()
  render(
    <AppProviders client={client}>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('Probe content')).toBeVisible()
  expect(seen?.client).toBe(client)
  expect(seen?.theme).toBe(theme)
  expect(GlobalStyles).toHaveBeenCalled()
})

it('falls back to the shared application query client', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(seen?.client).toBe(queryClient)
})
