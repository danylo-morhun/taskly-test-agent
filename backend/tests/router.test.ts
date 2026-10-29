import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteCompleted: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('returns validation issues in the 422 body for invalid create input', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').send({ title: '' });
  expect(response.status).toBe(422);
  expect(response.body.detail).toEqual([expect.objectContaining({ path: ['title'] })]);
});
it('gets a task by ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when the requested task does not exist', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/5');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(5);
});
it.each(['0', '-1', 'abc', '1.5', '9007199254740992'])('rejects invalid id %s before reaching the repository', async (id) => {
  const { app, repository } = setup();
  const response = await request(app).get(`/api/todos/${id}`);
  expect(response.status).toBe(422);
  expect(response.body.detail).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]));
  expect(repository.get).not.toHaveBeenCalled();
});
it.each(['patch', 'delete'] as const)('rejects invalid ids on %s before reaching the repository', async (method) => {
  const { app, repository } = setup();
  const response = await request(app)[method]('/api/todos/abc').send({ completed: true });
  expect(response.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('accepts the largest safe integer id', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  expect((await request(app).get('/api/todos/9007199254740991')).status).toBe(200);
  expect(repository.get).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
});
it('updates a task with validated, trimmed input', async () => {
  const { app, repository } = setup();
  const updated = { ...todo, title: 'Renamed', completed: true };
  repository.update.mockResolvedValue(updated);
  const response = await request(app).patch('/api/todos/3').send({ title: '  Renamed ', completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(updated);
  expect(repository.update).toHaveBeenCalledWith(3, { title: 'Renamed', completed: true });
});
it('returns 404 when updating a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/7').send({ completed: true });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.update).toHaveBeenCalledWith(7, { completed: true });
});
it.each([{}, { title: '' }, { priority: 'urgent' }, { completed: 'yes' }, { unknown: 1 }])(
  'rejects invalid update input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    const response = await request(app).patch('/api/todos/1').send(payload);
    expect(response.status).toBe(422);
    expect(Array.isArray(response.body.detail)).toBe(true);
    expect(repository.update).not.toHaveBeenCalled();
  },
);
it('deletes a task and responds with 204 and no body', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/4');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(4);
});
it('clears completed tasks and responds with the deleted count', async () => {
  const { app, repository } = setup();
  repository.deleteCompleted.mockResolvedValue(3);
  const response = await request(app).delete('/api/todos/completed');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: 3 });
  expect(repository.deleteCompleted).toHaveBeenCalledOnce();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('responds with zero when there are no completed tasks to clear', async () => {
  const { app, repository } = setup();
  repository.deleteCompleted.mockResolvedValue(0);
  const response = await request(app).delete('/api/todos/completed');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: 0 });
});
it('returns 404 when deleting a missing task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(false);
  const response = await request(app).delete('/api/todos/4');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
