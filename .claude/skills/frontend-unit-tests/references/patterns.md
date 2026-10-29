# Frontend test patterns

Copy the closest pattern, then adapt. Snippets follow the project's Prettier style.

## Query / mutation hooks — fresh QueryClient + mocked API

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

it('prepends the created task to the cached list', async () => {
  const { queryClient, wrapper } = setup()
  const existing: Todo = { ...todoFixture, id: 1 }
  queryClient.setQueryData(todoKeys.list, [existing])
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  expect(todosApi.create).toHaveBeenCalledWith(todoFixture)
  expect(queryClient.getQueryData(todoKeys.list)).toEqual([todoFixture, existing])
})
```

- Test files with JSX must use the `.tsx` extension.
- Query hook: `await waitFor(() => expect(result.current.isSuccess).toBe(true))`, then assert `result.current.data` and the arguments the API received (e.g. an `AbortSignal`: `expect.any(AbortSignal)`).
- Mutation error path: `mockRejectedValue(new Error('x'))`, `await expect(act(() => result.current.mutateAsync(…))).rejects.toThrow('x')`, cache unchanged.
- Busy state (`useIsMutating`): start a mutation whose promise you control (`let resolve!: (v: Todo) => void; mockReturnValue(new Promise((r) => (resolve = r)))`), assert `true`, resolve, `await waitFor(() => expect(…).toBe(false))`.
- Cache is `undefined` before any query: cover updaters that handle `current = []` / `current?.…`.

## `lib/http` — stub global fetch

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { request } from './http'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body?: unknown) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  )
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('prefixes the API path and sends JSON headers', async () => {
  const fetch = respond(200, { ok: true })
  await expect(request('/todos', { method: 'POST' })).resolves.toEqual({ ok: true })
  expect(fetch).toHaveBeenCalledWith('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- Network failure: `vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))`.
- Aborted request: pass an aborted `AbortController().signal` and expect the original error to propagate.
- `204`: `new Response(null, { status: 204 })` → resolves `undefined`.

## Container component — mocked hooks and children

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))

it('deletes the task and reports success', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  const onDeleted = vi.fn()
  render(<DeleteTodoDialog todo={todoFixture} busy={false} onClose={vi.fn()} onDeleted={onDeleted} />)
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
})
```

- When a child component is irrelevant, mock it to a marker that exposes the props you need to drive:
  `vi.mock('./TodoForm', () => ({ TodoForm: ({ onSubmit }) => <button onClick={() => void onSubmit(todoFixture)}>Submit form</button> }))`
- Design-system mocks render native elements: `Button` → `<button>`, `Input`/`Select` → `<label>` + control (query by label), `Alert` → `data-testid="alert"`, `Drawer` → `role="dialog"` named by `title` with a "Close" button.

## Timers — `useNotice`

```ts
afterEach(() => vi.useRealTimers())

it('clears the notice after four seconds', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  expect(result.current.message).toBe('Saved.')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Saved.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})
```

## Providers — `AppProviders`

Render a probe child that reads context: `useQueryClient()` must return the client passed via `client`, and the styled-components theme must be available (`useTheme()` from `styled-components` returns `theme`). Mock `GlobalStyles` via the design-system mocks or assert it does not crash.
