import { spawnSync } from 'node:child_process';
import { sanitizedEnv } from './env.mjs';

/** Runs a command with a sanitized environment and captures output. Never uses a shell. */
export function run(command, args, { cwd, env = {}, timeoutMs = 10 * 60_000 } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: sanitizedEnv(env),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    code: result.status ?? (result.signal ? 124 : 1),
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
    error: result.error?.message,
  };
}

export function tail(text, lines = 40) {
  return String(text).trimEnd().split('\n').slice(-lines).join('\n');
}
