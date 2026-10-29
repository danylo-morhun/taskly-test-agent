import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

afterEach(() => vi.unstubAllEnvs());

function stubPostgres(overrides: Record<string, string> = {}) {
  const values = { DATABASE_URL: '', POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss', POSTGRES_HOST: 'db', DB_PORT: '5432', POSTGRES_DB: 'app', ...overrides };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

it('prefers an explicit override over the environment', () => {
  stubPostgres({ DATABASE_URL: 'postgresql://env:env@env:1/env' });
  expect(resolveDatabaseUrl('postgresql://a:b@host:1/override')).toBe('postgresql://a:b@host:1/override');
});
it('uses DATABASE_URL when no override is given', () => {
  stubPostgres({ DATABASE_URL: 'postgresql://env:env@env:1/env' });
  expect(resolveDatabaseUrl()).toBe('postgresql://env:env@env:1/env');
});
it('falls back to DATABASE_URL when the override is empty', () => {
  stubPostgres({ DATABASE_URL: 'postgresql://env:env@env:1/env' });
  expect(resolveDatabaseUrl('')).toBe('postgresql://env:env@env:1/env');
});
it('normalizes SQLAlchemy psycopg URLs to plain postgresql', () => {
  stubPostgres();
  expect(resolveDatabaseUrl('postgresql+psycopg://u:p@h:5432/d')).toBe('postgresql://u:p@h:5432/d');
});
it('only rewrites the psycopg scheme prefix', () => {
  stubPostgres();
  expect(resolveDatabaseUrl('postgresql://u:p@h:5432/postgresql+psycopg:')).toBe('postgresql://u:p@h:5432/postgresql+psycopg:');
});
it('builds an encoded URL from discrete variables', () => {
  stubPostgres();
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss@db:5432/app');
});
it('encodes the database name', () => {
  stubPostgres({ POSTGRES_DB: 'my db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss@db:5432/my%20db');
});
it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'])('throws when %s is missing', (name) => {
  stubPostgres({ [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
