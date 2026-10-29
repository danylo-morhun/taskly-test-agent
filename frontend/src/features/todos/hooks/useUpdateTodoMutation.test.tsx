import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryClientWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo, TodoInput } from '../types'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

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
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  const update = (id: number, input: Partial<TodoInput>) =>
    act(() => result.current.mutateAsync({ id, input }))
  return { queryClient, update }
}

it('sends the id and input and replaces the cached task in place', async () => {
  const { queryClient, update } = setup()
  const other: Todo = { ...todoFixture, id: 1 }
  const saved: Todo = { ...todoFixture, completed: true }
  queryClient.setQueryData(todoKeys.list, [todoFixture, other])
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  await update(7, { completed: true })
  expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('keeps the cache empty when no list is cached', async () => {
  const { queryClient, update } = setup()
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  await update(7, { title: 'x' })
  expect(queryClient.getQueryData(todoKeys.list)).toBeUndefined()
})

it('cancels in-flight list queries and tags the update key', async () => {
  const { queryClient, update } = setup()
  const cancel = vi.spyOn(queryClient, 'cancelQueries')
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  await update(7, {})
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
  const cache = queryClient.getMutationCache()
  const mutations = cache.findAll({ mutationKey: todoKeys.update })
  expect(mutations).toHaveLength(1)
})

it('leaves the cache unchanged when the update fails', async () => {
  const { queryClient, update } = setup()
  queryClient.setQueryData(todoKeys.list, [todoFixture])
  vi.mocked(todosApi.update).mockRejectedValue(new Error('Conflict'))
  await expect(update(7, { title: 'x' })).rejects.toThrow('Conflict')
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
