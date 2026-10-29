---
name: frontend-unit-tests
description: Writes and updates Vitest + React Testing Library unit tests for the React 19 / TanStack Query / styled-components frontend in frontend/, following the project's conventions (design-system mocks, colocated tests, user-event, Prettier style). Use whenever tests must be created or changed under frontend/src/.
license: MIT
compatibility: Vitest 4 (jsdom), React 19, @testing-library/react 16, user-event 14, TanStack Query 5.
metadata:
  version: "1.0.0"
  workspace: frontend
---

# Frontend unit tests (React + RTL + TanStack Query)

Read the nearest existing test (same folder or same kind: component / hook / util) before writing. Code patterns are in [references/patterns.md](references/patterns.md); load it when you write the first test.

## Conventions (non-negotiable)

- **Location**: colocated — `Foo.tsx` → `Foo.test.tsx`, `useFoo.ts` → `useFoo.test.ts(x)`, `utils/x.ts` → `utils/x.test.ts`. Extend an existing test file for the module.
- **Imports**: explicit `import { describe, expect, it, vi } from 'vitest'`. RTL from `@testing-library/react`, interactions via `userEvent.setup()` from `@testing-library/user-event`. Matchers from jest-dom are global (setup file).
- **Style (Prettier)**: no semicolons, single quotes, trailing commas, 80 columns. CI runs `prettier --check` on every changed test — format as Prettier would.
- **Fixtures**: `src/test/todoFixture.ts` (`todoFixture`). Override fields with spread: `{ ...todoFixture, completed: true }`. New shared helpers go in `src/test/` (never edit `src/test/setup.ts`).
- **Design system**: components under test import from `design-system`; mock it with the project mocks so tests stay independent of styling:
  `vi.mock('../../../design-system', () => import('../../../design-system/mocks'))` (relative path from the test file).

## Seams — what to mock

| Unit | Render/call through | Mock |
| --- | --- | --- |
| Presentational component | `render(<Comp …props />)` | design system; callbacks as `vi.fn()` |
| Container component (`TodosPage`, `TodoEditor`, `DeleteTodoDialog`) | `render` | its hooks (`vi.mock('../hooks/useX', () => ({ useX: vi.fn() }))`) and heavy children |
| Query/mutation hook | `renderHook` with a fresh `QueryClientProvider` wrapper | `todosApi` module |
| `todosApi` | direct call | `lib/http` `request` |
| `lib/http` | direct call | global `fetch` via `vi.stubGlobal` |
| Pure utils | direct call | nothing (control time with fake timers) |

Mocked hook return values: `vi.mocked(useX).mockReturnValue({ … } as unknown as ReturnType<typeof useX>)` — provide only the fields the component reads.

## What to assert

- What the **user perceives**: roles, accessible names, text, disabled state, visibility (`getByRole`, `getByLabelText`, `toBeVisible`, `toBeDisabled`). Avoid `container.querySelector`, CSS and snapshot assertions.
- What the unit **emits**: callback calls with exact arguments, API calls with exact payloads, query-cache contents after a mutation (`queryClient.getQueryData(todoKeys.list)`).
- Every branch the change introduced: loading, empty, error, disabled/busy, success.
- Absence matters: `not.toHaveBeenCalled()`, `queryByText(...)).not.toBeInTheDocument()`.

## Determinism

- Time: `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))`; restore with `vi.useRealTimers()` in `afterEach`. With user-event and fake timers use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- Async UI: `await screen.findBy…` or `await waitFor(() => expect(…))`; never arbitrary sleeps.
- Each test creates its own `QueryClient` with `retry: false` — never reuse `lib/queryClient`.
- The runner sets `TZ=UTC`; still avoid asserting locale-dependent strings unless the code fixes the locale (`formatDate` uses `en-GB`).

## Running

```bash
node .claude/skills/test-verification/scripts/run-tests.mjs --workspace frontend --files frontend/src/<path>.test.tsx
```
