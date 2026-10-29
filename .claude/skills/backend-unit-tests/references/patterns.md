# Backend test patterns

Copy the closest pattern, then adapt. All snippets follow the project style (semicolons, single quotes, `.ts` imports).

## Router (unit) — fake repository + supertest

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('returns 404 when the task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/5');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(5);
});

it.each(['0', 'abc', '1.5'])('rejects invalid id %s before reaching the repository', async (id) => {
  const { app, repository } = setup();
  expect((await request(app).get(`/api/todos/${id}`)).status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
});
```

## Application (integration of factory + routers) — real Prisma delegate, IO spied

```ts
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // No connection is opened until a query runs; spies replace the IO.
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it('maps malformed JSON bodies to 422', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});

it('hides unexpected errors behind a generic 500', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('connection reset'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection reset' }));
});
```

- Body too large: `express.json()` defaults to 100 kB → `.send({ title: 'x', description: 'x'.repeat(150_000) })` yields 413.
- Unknown routes: any path → `404 { detail: 'Not Found' }`.
- `x-powered-by` is disabled: `expect(response.headers['x-powered-by']).toBeUndefined()`.
- Express 5 forwards rejected async handlers to the error handler — no extra wrapper needed.

## Environment-dependent config

```ts
import { afterEach, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

function stubPostgres(overrides: Record<string, string> = {}) {
  const values = { DATABASE_URL: '', POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'app', ...overrides };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

it('builds an encoded URL from discrete variables', () => {
  stubPostgres();
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss@db:5432/app');
});
```

- The module loads a repo-root `.env` on import. Stub **every** variable a test depends on (use `''` for "unset": the code treats empty as missing) so a developer's local `.env` cannot change results.

## Modules with side effects (lifespan, process signals)

```ts
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn(() => 'postgresql://test') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

function fakeServer() {
  return Object.assign(new EventEmitter(), {
    address: () => ({ port: 8000 }),
    close: vi.fn((callback: () => void) => callback()),
  });
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'once').mockImplementation(() => process); // never register real signal handlers
});
afterEach(() => vi.restoreAllMocks());
```

- `vi.mock('../src/core/database.ts')` also replaces the `./database.js` import inside the source (same resolved module).
- `app.listen(port, host, callback)`: the source reads the returned server **inside** the callback, so a fake `listen` must invoke the callback asynchronously: `listen: vi.fn((_p, _h, cb) => { queueMicrotask(cb); return server; })`.
- To test shutdown, grab the handler from `vi.mocked(process.once).mock.calls` and call it; assert `server.close` and `database.$disconnect`.
- Never let `process.exit` run: `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`.
- Prefer `vi.mocked(createDatabase).mockReturnValue(database as never)` with `database = { $connect: vi.fn(), $disconnect: vi.fn() }`.

## Repository — see `tests/repository.test.ts`

Spy the Prisma delegate method the repository calls (`findMany`, `findUnique`, `create`, `updateManyAndReturn`, `deleteMany`, …), assert the exact query object passed and the mapped result. Cover: empty results, `null`/missing rows, invalid input rejected before any query, errors propagated.
