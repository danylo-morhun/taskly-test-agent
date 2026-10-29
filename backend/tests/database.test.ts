import { afterEach, it, expect, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { createDatabase, initialize } from '../src/core/database.ts';

vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn(function PrismaPg(this: { kind: string }) { this.kind = 'adapter'; }) }));
vi.mock('../src/generated/prisma/client.ts', () => ({ PrismaClient: vi.fn(function PrismaClient(this: { kind: string }) { this.kind = 'client'; }) }));

afterEach(() => vi.clearAllMocks());

it('creates a Prisma client over a pg adapter with a connection timeout', () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  expect(PrismaPg).toHaveBeenCalledWith({ connectionString: 'postgresql://test:test@localhost:5432/test', connectionTimeoutMillis: 10000 });
  const adapter = vi.mocked(PrismaPg).mock.instances[0];
  expect(PrismaClient).toHaveBeenCalledWith({ adapter });
  expect(database).toBe(vi.mocked(PrismaClient).mock.instances[0]);
});
it('creates the todos table if it does not exist', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw } as never);
  expect($executeRaw).toHaveBeenCalledOnce();
  const [strings, ...values] = $executeRaw.mock.calls[0];
  expect(values).toEqual([]);
  const sql = (strings as string[]).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain('title VARCHAR(120) NOT NULL');
  expect(sql).toContain("priority IN ('low', 'medium', 'high')");
  expect(sql).toContain('completed BOOLEAN NOT NULL DEFAULT FALSE');
});
it('propagates database errors from initialization', async () => {
  const $executeRaw = vi.fn().mockRejectedValue(new Error('permission denied'));
  await expect(initialize({ $executeRaw } as never)).rejects.toThrow('permission denied');
});
