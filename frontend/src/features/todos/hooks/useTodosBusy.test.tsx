import { useMutation } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createQueryWrapper } from '../../../test/queryClientWrapper'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function useHarness(mutationKey: readonly string[]) {
  const busy = useTodosBusy()
  const mutation = useMutation({
    mutationKey,
    mutationFn: (promise: Promise<void>) => promise,
  })
  return { busy, mutate: mutation.mutate }
}

it('is idle without running mutations', () => {
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  expect(result.current).toBe(false)
})

it.each([
  { key: todoKeys.create },
  { key: todoKeys.update },
  { key: todoKeys.delete },
])('is busy while a $key mutation runs', async ({ key }) => {
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useHarness(key), { wrapper })
  let resolve!: () => void
  act(() => result.current.mutate(new Promise((r) => (resolve = r))))
  await waitFor(() => expect(result.current.busy).toBe(true))
  act(() => resolve())
  await waitFor(() => expect(result.current.busy).toBe(false))
})

it('ignores mutations outside the todos key', async () => {
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useHarness(['profile']), { wrapper })
  let resolve!: () => void
  act(() => result.current.mutate(new Promise((r) => (resolve = r))))
  await waitFor(() => expect(queryClient.isMutating()).toBe(1))
  expect(result.current.busy).toBe(false)
  act(() => resolve())
  await waitFor(() => expect(queryClient.isMutating()).toBe(0))
})
