import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import { resolveDatabaseUrl } from '../src/core/config.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn(() => 'postgresql://test') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

function fakeServer() {
  return Object.assign(new EventEmitter(), {
    address: () => ({ port: 8123 }),
    close: vi.fn((callback: () => void | Promise<void>) => { void callback(); }),
  });
}

function setup({ listenError }: { listenError?: Error } = {}) {
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = fakeServer();
  const app = {
    listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(() => (listenError ? server.emit('error', listenError) : callback()));
      return server;
    }),
  };
  vi.mocked(createDatabase).mockReturnValue(database as never);
  vi.mocked(initialize).mockResolvedValue(undefined);
  vi.mocked(createApp).mockReturnValue(app as never);
  return { database, server, app };
}

function signalHandler(signal: string) {
  const call = vi.mocked(process.once).mock.calls.find(([name]) => name === signal);
  return call![1] as () => void;
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'once').mockImplementation(() => process); // never register real signal handlers
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  process.exitCode = undefined;
});

it('connects, initializes the schema, and listens on API_PORT', async () => {
  vi.stubEnv('API_PORT', '9001');
  const { database, server, app } = setup();
  const result = await start();
  expect(resolveDatabaseUrl).toHaveBeenCalledWith();
  expect(createDatabase).toHaveBeenCalledWith('postgresql://test');
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(app.listen).toHaveBeenCalledWith(9001, '0.0.0.0', expect.any(Function));
  expect(log).toHaveBeenCalledWith('Taskly App Node API listening on port 8123');
  expect(result).toEqual({ server, database });
  expect(database.$disconnect).not.toHaveBeenCalled();
});
it('defaults to port 8000 when API_PORT is unset', async () => {
  vi.stubEnv('API_PORT', '');
  const { app } = setup();
  await start();
  expect(app.listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});
it('registers graceful shutdown for SIGTERM and SIGINT', async () => {
  setup();
  await start();
  expect(process.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  expect(process.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  expect(signalHandler('SIGTERM')).toBe(signalHandler('SIGINT'));
});
it('closes the server and disconnects the database on shutdown', async () => {
  vi.useFakeTimers();
  const { database, server } = setup();
  await start();
  signalHandler('SIGTERM')();
  await vi.waitFor(() => expect(database.$disconnect).toHaveBeenCalledOnce());
  expect(server.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(10000);
  expect(process.exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
});
it('forces exit with code 1 when shutdown takes longer than 10 seconds', async () => {
  vi.useFakeTimers();
  const { server } = setup();
  server.close.mockImplementation(() => {});
  await start();
  signalHandler('SIGINT')();
  await vi.advanceTimersByTimeAsync(9999);
  expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(process.exit).toHaveBeenCalledWith(1);
});
it('does not let the shutdown watchdog keep the process alive', async () => {
  const { server } = setup();
  server.close.mockImplementation(() => {});
  await start();
  const unref = vi.fn();
  const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => ({ unref })) as never);
  signalHandler('SIGTERM')();
  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
  expect(unref).toHaveBeenCalledOnce();
});
it('logs and sets exit code 1 when disconnecting fails during shutdown', async () => {
  vi.useFakeTimers();
  const { database } = setup();
  const failure = new Error('disconnect failed');
  database.$disconnect.mockRejectedValue(failure);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await start();
  signalHandler('SIGTERM')();
  await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(failure));
  expect(process.exitCode).toBe(1);
  await vi.advanceTimersByTimeAsync(10000);
  expect(process.exit).not.toHaveBeenCalled();
});
it('disconnects and rethrows when connecting fails', async () => {
  const { database, app } = setup();
  database.$connect.mockRejectedValue(new Error('connection refused'));
  await expect(start()).rejects.toThrow('connection refused');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(initialize).not.toHaveBeenCalled();
  expect(app.listen).not.toHaveBeenCalled();
});
it('disconnects and rethrows when schema initialization fails', async () => {
  const { database, app } = setup();
  vi.mocked(initialize).mockRejectedValue(new Error('permission denied'));
  await expect(start()).rejects.toThrow('permission denied');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(app.listen).not.toHaveBeenCalled();
});
it('disconnects and rethrows when the server cannot listen', async () => {
  const { database } = setup({ listenError: new Error('EADDRINUSE') });
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(process.once).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
});
