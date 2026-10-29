import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs, list } from '../lib/args.mjs';
import { classifyPath, isWritableTestPath, loadConfig, toRepoPath, repoRoot } from '../lib/config.mjs';
import { parseAddedLines, parseNameStatus, toRanges } from '../lib/diff.mjs';
import { sanitizedEnv } from '../lib/env.mjs';
import { assertRef } from '../lib/git.mjs';
import { globToRegExp, matchesAny } from '../lib/glob.mjs';
import { parseLcov, patchCoverage } from '../lib/lcov.mjs';
import { code, sanitizeInline } from '../lib/markdown.mjs';

const config = loadConfig();

describe('glob', () => {
  it('matches globstar, star, alternation and question mark', () => {
    assert.ok(matchesAny('backend/src/a/b/c.ts', ['backend/src/**/*.ts']));
    assert.ok(matchesAny('backend/src/c.ts', ['backend/src/**/*.ts']), '**/ matches zero directories');
    assert.ok(matchesAny('frontend/src/A.test.tsx', ['frontend/src/**/*.test.{ts,tsx}']));
    assert.ok(matchesAny('a/b.ts', ['a/?.ts']));
    assert.ok(!matchesAny('backend/srcx/c.ts', ['backend/src/**/*.ts']));
    assert.ok(!matchesAny('backend/src/a.tsx', ['backend/src/**/*.ts']));
    assert.ok(!matchesAny('a/b/c.ts', ['a/*.ts']), 'single star does not cross directories');
  });
  it('escapes regex metacharacters', () => {
    assert.ok(globToRegExp('a.b/(x)+.ts').test('a.b/(x)+.ts'));
    assert.ok(!globToRegExp('a.b').test('axb'));
  });
});

describe('config', () => {
  const cases = [
    ['backend/src/factory.ts', 'source', 'backend'],
    ['backend/src/features/todos/types.ts', 'excluded', 'backend'],
    ['backend/src/generated/prisma/client.ts', 'excluded', 'backend'],
    ['backend/tests/router.test.ts', 'test', 'backend'],
    ['backend/package.json', 'other', 'backend'],
    ['frontend/src/lib/http.ts', 'source', 'frontend'],
    ['frontend/src/lib/http.test.ts', 'test', 'frontend'],
    ['frontend/src/design-system/components/Badge/Badge.tsx', 'excluded', 'frontend'],
    ['frontend/src/test/todoFixture.ts', 'test', 'frontend'],
    ['frontend/src/styles.css', 'other', 'frontend'],
    ['README.md', 'other', null],
    ['.github/workflows/ci.yml', 'other', null],
  ];
  for (const [path, kind, workspace] of cases) {
    it(`classifies ${path} as ${kind}`, () => assert.deepEqual(classifyPath(config, path), { kind, workspace }));
  }
  it('allows writing tests and helpers but not protected files or source', () => {
    assert.ok(isWritableTestPath(config, 'backend/tests/health.test.ts'));
    assert.ok(isWritableTestPath(config, 'frontend/src/lib/http.test.ts'));
    assert.ok(isWritableTestPath(config, 'frontend/src/test/renderWithProviders.tsx'));
    assert.ok(!isWritableTestPath(config, 'frontend/src/test/setup.ts'), 'setup is protected');
    assert.ok(!isWritableTestPath(config, 'backend/src/factory.ts'));
    assert.ok(!isWritableTestPath(config, 'backend/vitest.config.ts'));
    assert.ok(!isWritableTestPath(config, '.claude/test-agent/config.json'));
    assert.ok(!isWritableTestPath(config, null));
  });
  it('normalizes paths and rejects paths outside the repository', () => {
    assert.equal(toRepoPath(`${repoRoot}/backend/tests/x.test.ts`), 'backend/tests/x.test.ts');
    assert.equal(toRepoPath('backend/../backend/tests/x.test.ts'), 'backend/tests/x.test.ts');
    assert.equal(toRepoPath('../outside.ts'), null);
    assert.equal(toRepoPath('/etc/passwd'), null);
    assert.equal(toRepoPath(repoRoot), null);
  });
});

describe('diff parsing', () => {
  it('parses name-status including renames', () => {
    assert.deepEqual(parseNameStatus('M\ta.ts\nR087\told.ts\tnew.ts\nD\tgone.ts\n'), [
      { status: 'M', path: 'a.ts' },
      { status: 'R', path: 'new.ts', previousPath: 'old.ts' },
      { status: 'D', path: 'gone.ts' },
    ]);
  });
  it('parses added lines from -U0 hunks, ignoring deletions and /dev/null', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts',
      '@@ -1,0 +2,3 @@', '+a', '+b', '+c',
      '@@ -10 +12 @@', '-old', '+new',
      '@@ -20,2 +23,0 @@', '-gone', '-gone',
      'diff --git a/d.ts b/d.ts', '--- a/d.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
    ].join('\n');
    assert.deepEqual([...parseAddedLines(diff)], [['x.ts', [2, 3, 4, 12]]]);
  });
  it('collapses lines into ranges', () => {
    assert.deepEqual(toRanges([5, 1, 2, 3, 9, 10]), [[1, 3], [5, 5], [9, 10]]);
    assert.deepEqual(toRanges([]), []);
  });
});

describe('lcov and patch coverage', () => {
  const lcov = `TN:\nSF:src/a.ts\nDA:1,1\nDA:2,0\nDA:4,3\nend_of_record\nSF:${repoRoot}/backend/src/b.ts\nDA:1,0\nend_of_record\n`;
  const coverage = parseLcov(lcov, `${repoRoot}/backend`);
  it('resolves relative and absolute SF paths to repo paths', () => {
    assert.deepEqual([...coverage.keys()], ['backend/src/a.ts', 'backend/src/b.ts']);
  });
  it('counts only executable changed lines', () => {
    const result = patchCoverage(new Map([['backend/src/a.ts', [1, 2, 3]], ['backend/src/b.ts', [1]], ['backend/src/new.ts', [1, 2]]]), coverage);
    assert.equal(result.covered, 1);
    assert.equal(result.total, 3);
    assert.equal(result.percent, 33.3);
    assert.deepEqual(result.files[0].missedLines, [2]);
    assert.equal(result.files[2].instrumented, false);
  });
  it('reports null percent when nothing is executable', () => {
    assert.equal(patchCoverage(new Map([['x.ts', [1]]]), new Map()).percent, null);
  });
});

describe('security helpers', () => {
  it('passes only allowlisted variables to child processes', () => {
    process.env.ANTHROPIC_API_KEY = 'secret';
    process.env.GITHUB_TOKEN = 'secret';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'secret';
    const env = sanitizedEnv({ DATABASE_URL: 'postgresql://test' });
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(env.TZ, 'UTC');
    assert.equal(env.DATABASE_URL, 'postgresql://test');
    assert.ok(env.PATH);
  });
  it('rejects option-like or malformed git refs', () => {
    assert.equal(assertRef('origin/main'), 'origin/main');
    assert.equal(assertRef('abc123^'), 'abc123^');
    assert.throws(() => assertRef('--output=/tmp/x'));
    assert.throws(() => assertRef('a b'));
    assert.throws(() => assertRef('$(id)'));
  });
  it('neutralizes markup, links, mentions and issue references in agent text', () => {
    const out = sanitizeInline('<img src=x onerror=alert(1)> [click](https://evil.example) @maintainer #12 a|b\n![x](y)');
    assert.ok(!out.includes('<img'));
    assert.ok(!out.includes('](https://'));
    assert.ok(!/@maintainer/.test(out));
    assert.ok(!/#12/.test(out));
    assert.ok(out.includes('a\\|b'));
    assert.ok(!out.includes('\n'));
  });
  it('truncates long text and keeps code spans single-line', () => {
    assert.equal(sanitizeInline('x'.repeat(500), 10).length, 10);
    assert.equal(code('a`b\nc|d'), '`abc\\|d`');
  });
});

describe('args', () => {
  it('parses flags, values, inline values and lists', () => {
    const args = parseArgs(['--base', 'main', '--coverage', '--files=a.ts,b.ts', 'extra', '--last'], { booleans: ['coverage'] });
    assert.deepEqual(args, { _: ['extra'], base: 'main', coverage: true, files: 'a.ts,b.ts', last: true });
    assert.deepEqual(list(args.files), ['a.ts', 'b.ts']);
    assert.deepEqual(list(undefined), []);
  });
});
