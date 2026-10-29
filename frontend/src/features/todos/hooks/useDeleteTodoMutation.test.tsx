import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryClientWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const { queryClient, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  const remove = (id: number) => act(() => result.current.mutateAsync(id))
  return { queryClient, remove }
}

it('removes the deleted task from the cached list', async () => {
  const { queryClient, remove } = setup()
  const other: Todo = { ...todoFixture, id: 1 }
  queryClient.setQueryData(todoKeys.list, [todoFixture, other])
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  await remove(7)
  expect(todosApi.remove).toHaveBeenCalledWith(7)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([other])
})

it('keeps the cache empty when no list is cached', async () => {
  const { queryClient, remove } = setup()
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  await remove(7)
  expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
})

it('cancels in-flight list queries and tags the delete key', async () => {
  const { queryClient, remove } = setup()
  const cancel = vi.spyOn(queryClient, 'cancelQueries')
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  await remove(7)
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
  const cache = queryClient.getMutationCache()
  const mutations = cache.findAll({ mutationKey: todoKeys.delete })
  expect(mutations).toHaveLength(1)
})

it('keeps the task cached when deletion fails', async () => {
  const { queryClient, remove } = setup()
  queryClient.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Not found'))
  await expect(remove(7)).rejects.toThrow('Not found')
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
