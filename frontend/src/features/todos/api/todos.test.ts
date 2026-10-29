import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})

it('patches only writable fields of the task with the given id', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(request).mockResolvedValue(saved)
  await expect(
    todosApi.update(7, { ...saved, title: 'Renamed' }),
  ).resolves.toEqual(saved)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Renamed',
      description: '',
      priority: 'medium',
      due_date: null,
      completed: true,
    }),
  })
})

it('omits fields that a partial update does not set', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await todosApi.update(3, { completed: true })
  expect(request).toHaveBeenCalledWith('/todos/3', {
    method: 'PATCH',
    body: '{"completed":true}',
  })
})

it('deletes the task with the given id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await expect(todosApi.remove(5)).resolves.toBeUndefined()
  expect(request).toHaveBeenCalledWith('/todos/5', { method: 'DELETE' })
})

it('clears completed tasks and returns the deleted count', async () => {
  vi.mocked(request).mockResolvedValue({ deleted: 2 })
  await expect(todosApi.clearCompleted()).resolves.toEqual({ deleted: 2 })
  expect(request).toHaveBeenCalledWith('/todos/completed', {
    method: 'DELETE',
  })
})
