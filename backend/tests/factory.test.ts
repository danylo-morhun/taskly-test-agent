import request from 'supertest';
import { readFileSync } from 'node:fs';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // No connection is opened until a query runs; spies replace the IO.
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it('mounts the health endpoint under /api', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});
it('mounts the todos router backed by the Prisma repository', async () => {
  const { database, app } = setup();
  const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(findMany).toHaveBeenCalledOnce();
});
it('parses JSON request bodies', async () => {
  const { database, app } = setup();
  const create = vi.spyOn(database.todo, 'create').mockResolvedValue(record);
  const response = await request(app).post('/api/todos').send({ title: 'Plan the sprint' });
  expect(response.status).toBe(201);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'Plan the sprint' }) }));
});
it('serves the OpenAPI specification', async () => {
  const { app } = setup();
  const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  const response = await request(app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(specification);
});
it('serves the Swagger UI under /docs', async () => {
  const { app } = setup();
  const response = await request(app).get('/docs/');
  expect(response.status).toBe(200);
  expect(response.text).toContain('swagger-ui');
});
it('does not advertise the framework', async () => {
  const { app } = setup();
  const response = await request(app).get('/openapi.json');
  expect(response.headers['x-powered-by']).toBeUndefined();
});
it('answers unknown routes with a JSON 404', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('maps malformed JSON bodies to 422', async () => {
  const { database, app } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(create).not.toHaveBeenCalled();
});
it('maps oversized bodies to 413', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: 'x', description: 'x'.repeat(150_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('hides unexpected errors behind a generic 500 and logs them', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('connection reset'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection reset' }));
});
it.each(['boom', { type: 'other' }, { status: 400 }])('treats non-parser error %j as a 500', async (thrown) => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findMany').mockImplementation(() => { throw thrown; });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(consoleError).toHaveBeenCalledWith(thrown);
});
