import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createHealthRouter } from '../src/api/health.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { database, app };
}

it('reports ok after probing the database', async () => {
  const { database, app } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('does not report ok when the database probe fails', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('connection refused'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'ok' });
});
