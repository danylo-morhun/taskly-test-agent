import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryClientWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clearCompleted: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper,
  })
  const clear = () => act(() => result.current.mutateAsync())
  return { queryClient, clear }
}

it('removes completed tasks from the cached list and returns the count', async () => {
  const { queryClient, clear } = setup()
  const done: Todo = { ...todoFixture, id: 8, completed: true }
  const other: Todo = { ...todoFixture, id: 1 }
  queryClient.setQueryData(todoKeys.list, [todoFixture, done, other])
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  await expect(clear()).resolves.toEqual({ deleted: 1 })
  expect(todosApi.clearCompleted).toHaveBeenCalledTimes(1)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
})

it('keeps the cache empty when no list is cached', async () => {
  const { queryClient, clear } = setup()
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  await clear()
  expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
})

it('cancels in-flight list queries and tags the clear-completed key', async () => {
  const { queryClient, clear } = setup()
  const cancel = vi.spyOn(queryClient, 'cancelQueries')
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  await clear()
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
  const cache = queryClient.getMutationCache()
  const mutations = cache.findAll({ mutationKey: todoKeys.clearCompleted })
  expect(mutations).toHaveLength(1)
})

it('keeps completed tasks cached when clearing fails', async () => {
  const { queryClient, clear } = setup()
  const done: Todo = { ...todoFixture, id: 8, completed: true }
  queryClient.setQueryData(todoKeys.list, [todoFixture, done])
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(new Error('Offline'))
  await expect(clear()).rejects.toThrow('Offline')
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture, done])
})
