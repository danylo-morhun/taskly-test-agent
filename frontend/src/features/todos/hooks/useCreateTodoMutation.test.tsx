import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/queryClientWrapper'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

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
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  const create = () => act(() => result.current.mutateAsync(todoFixture))
  return { queryClient, create }
}

it('prepends the created task to the cached list', async () => {
  const { queryClient, create } = setup()
  const existing: Todo = { ...todoFixture, id: 1 }
  queryClient.setQueryData(todoKeys.list, [existing])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await create()
  expect(todosApi.create).toHaveBeenCalledWith(todoFixture)
  const cached = queryClient.getQueryData(todoKeys.list)
  expect(cached).toEqual([todoFixture, existing])
})

it('replaces a cached copy of the same task instead of duplicating it', async () => {
  const { queryClient, create } = setup()
  const other: Todo = { ...todoFixture, id: 1 }
  const stale: Todo = { ...todoFixture, title: 'Stale' }
  queryClient.setQueryData(todoKeys.list, [other, stale])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await create()
  const cached = queryClient.getQueryData(todoKeys.list)
  expect(cached).toEqual([todoFixture, other])
})

it('starts a list when nothing is cached yet', async () => {
  const { queryClient, create } = setup()
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await create()
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('cancels in-flight list queries before writing the cache', async () => {
  const { queryClient, create } = setup()
  const cancel = vi.spyOn(queryClient, 'cancelQueries')
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await create()
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
})

it('tags the mutation with the create key', async () => {
  const { queryClient, create } = setup()
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  await create()
  const cache = queryClient.getMutationCache()
  const mutations = cache.findAll({ mutationKey: todoKeys.create })
  expect(mutations).toHaveLength(1)
})

it('leaves the cache unchanged when creation fails', async () => {
  const { queryClient, create } = setup()
  const existing: Todo = { ...todoFixture, id: 1 }
  queryClient.setQueryData(todoKeys.list, [existing])
  vi.mocked(todosApi.create).mockRejectedValue(new Error('Server down'))
  await expect(create()).rejects.toThrow('Server down')
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([existing])
})
