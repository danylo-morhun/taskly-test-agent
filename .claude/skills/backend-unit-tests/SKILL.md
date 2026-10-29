---
name: backend-unit-tests
description: Writes and updates Vitest unit tests for the Node.js/Express/Prisma/Zod backend in backend/, following the project's existing test conventions (no database, no network, Prisma delegates spied, routers tested through supertest). Use whenever tests must be created or changed under backend/tests/.
license: MIT
compatibility: Vitest 4, Express 5, Prisma 7, Zod 4, supertest 7, Node.js >= 22.
metadata:
  version: "1.0.0"
  workspace: backend
---

# Backend unit tests (Express + Prisma + Zod)

Read 1–2 existing files in `backend/tests/` before writing — match them. Code patterns for every layer are in [references/patterns.md](references/patterns.md); load it when you write the first test.

## Conventions (non-negotiable)

- **Location**: `backend/tests/<module>.test.ts`, flat, named after the source module (`src/api/health.ts` → `tests/health.test.ts`). Extend an existing file for the module instead of creating a second one.
- **Imports**: explicit `import { describe, it, expect, vi, afterEach } from 'vitest'` (globals are off). Import source **with the `.ts` extension**: `from '../src/features/todos/router.ts'`.
- **Fixtures**: reuse `tests/fixture.ts` (`record` = Prisma row, `todo` = API JSON). Add new shared fixtures there only when two or more files need them.
- **Style**: 2 spaces, single quotes, semicolons, concise `it('does X when Y')` titles, `it.each` for input tables (see `validators.test.ts`).
- **Isolation**: `afterEach(() => vi.restoreAllMocks())` when spying; `vi.unstubAllEnvs()` when stubbing env; never share mutable state between tests.

## Seams — what to mock at each layer

| Layer | Test through | Mock |
| --- | --- | --- |
| `features/*/validators.ts` | Direct `schema.parse` / `safeParse` | Nothing |
| `features/*/mappers.ts` | Direct call | Nothing |
| `features/*/repository.ts` | `new TodoRepository(createDatabase('postgresql://test:test@localhost:5432/test'))` | `vi.spyOn(database.todo, '<method>')` — the real Prisma delegate, IO mocked |
| `features/*/router.ts` | `supertest` against `express()` + `express.json()` + the router | Repository object of `vi.fn()` implementing `TodoStore` |
| `factory.ts` / `api/*.ts` | `supertest` against `createApp(database)` | `vi.spyOn(database.todo, ...)` on a `createDatabase(...)` client |
| `core/config.ts` | Direct call | `vi.stubEnv(...)` |
| `core/lifespan.ts`, `core/database.ts` | Direct call | `vi.mock()` the modules it imports; spy `process.once` / `process.exit` |

Never connect to PostgreSQL, open real ports, or call the network. `createDatabase()` does not connect until a query runs — spying the delegate is enough.

## What to assert

- HTTP: **status code and body**, plus what the collaborator received (`toHaveBeenCalledWith`) and what it must not receive (`not.toHaveBeenCalled()` on validation failures).
- Every error branch: 404 for missing entities, 422 for invalid input/ids, 413/422 for body parser errors, 500 for unexpected errors (silence and assert `console.error`).
- Boundaries from the Zod schemas (120/121 chars, 2000/2001, invalid dates, `id` limits).
- Dates: build them with explicit UTC ISO strings; the runner forces `TZ=UTC`, but do not depend on it.

## Running

```bash
node .claude/skills/test-verification/scripts/run-tests.mjs --workspace backend --files backend/tests/<file>.test.ts
```

Prisma client must be generated (`npm ci` runs `prisma generate`). If imports from `src/generated/prisma` fail, report it — do not hand-write generated code.
