// Child processes that run project code (tests, mutation testing) get an
// allowlisted environment: no tokens or secrets can leak into code that a PR controls.
const ALLOWED = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'SHELL', 'USER', 'npm_config_cache'];

export function sanitizedEnv(extra = {}) {
  const env = {};
  for (const key of ALLOWED) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, TZ: 'UTC', NODE_ENV: 'test', FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
}
