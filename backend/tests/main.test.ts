import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/lifespan.ts', () => ({ start: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('starts the API on import', async () => {
  vi.mocked(start).mockResolvedValue({} as never);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/main.ts');
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(consoleError).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
it('logs the failure and sets exit code 1 when startup fails', async () => {
  const failure = new Error('connection refused');
  vi.mocked(start).mockRejectedValue(failure);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../src/main.ts');
  await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Cannot start Taskly App Node API:', failure));
  expect(process.exitCode).toBe(1);
});
