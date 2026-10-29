import { execFileSync } from 'node:child_process';

/** Runs the GitHub CLI without a shell. Token comes from GH_TOKEN. */
export function gh(args, { input, allowFailure = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${error.stderr || error.message}`);
  }
}

export function ghJson(args, options) {
  const out = gh(args, options);
  return out === null ? null : JSON.parse(out || 'null');
}

export function git(args, { cwd, env } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function output(values) {
  const lines = Object.entries(values).map(([key, value]) => {
    const text = String(value ?? '');
    if (/[\r\n]/.test(text)) throw new Error(`Refusing multi-line output for ${key}`);
    return `${key}=${text}`;
  });
  if (process.env.GITHUB_OUTPUT) {
    execFileSync('sh', ['-c', 'cat >> "$GITHUB_OUTPUT"'], { input: `${lines.join('\n')}\n` });
  }
  console.log(lines.join('\n'));
}

export function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const SHA = /^[0-9a-f]{40}$/;
