import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { toolRoot } from '../lib/config.mjs';

// detect-changes against a throwaway repository, run as a subprocess so
// TEST_AGENT_REPO_ROOT points the tooling at it.
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'detect-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const commit = (message) => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  write('backend/src/a.ts', 'export const a = 1;\n');
  write('README.md', '# x\n');
  return { root, git, write, commit, base: commit('base') };
}

function detect(root, args) {
  const out = execFileSync('node', [join(toolRoot, '.claude/skills/test-impact-analysis/scripts/detect-changes.mjs'), ...args], {
    env: { ...process.env, TEST_AGENT_REPO_ROOT: root }, encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('detect-changes', () => {
  it('runs for testable source changes and reports changed lines', () => {
    const r = repo();
    r.write('backend/src/a.ts', 'export const a = 2;\nexport const b = 3;\n');
    r.write('backend/src/features/x/types.ts', 'export type X = 1;\n');
    const head = r.commit('feature');
    const result = detect(r.root, ['--base', r.base, '--head', head]);
    assert.equal(result.run, true);
    assert.deepEqual(result.sources, [{ path: 'backend/src/a.ts', status: 'M', workspace: 'backend', changedLines: 2 }]);
    assert.deepEqual(result.excluded, ['backend/src/features/x/types.ts']);
  });
  it('skips docs-only changes without calling the agent', () => {
    const r = repo();
    r.write('README.md', '# changed\n');
    const result = detect(r.root, ['--base', r.base, '--head', r.commit('docs')]);
    assert.equal(result.run, false);
    assert.match(result.reason, /No testable source changes/);
  });
  it('skips a push that only added tests since the last analysis', () => {
    const r = repo();
    r.write('backend/src/a.ts', 'export const a = 2;\n');
    const first = r.commit('feature');
    r.write('backend/tests/a.test.ts', "it('x', () => expect(1).toBe(1))\n");
    const second = r.commit('tests');
    const result = detect(r.root, ['--base', r.base, '--head', second, '--since', first]);
    assert.equal(result.run, false);
    assert.match(result.reason, /since the last analyzed commit/);
  });
  it('re-runs when a PR source file changed since the last analysis', () => {
    const r = repo();
    r.write('backend/src/a.ts', 'export const a = 2;\n');
    const first = r.commit('feature');
    r.write('backend/src/a.ts', 'export const a = 3;\n');
    const result = detect(r.root, ['--base', r.base, '--head', r.commit('fix'), '--since', first]);
    assert.equal(result.run, true);
  });
  it('ignores upstream source changes brought in by a rebase', () => {
    const r = repo();
    r.write('backend/src/a.ts', 'export const a = 2;\n');
    const first = r.commit('feature');
    r.git('checkout', '-q', '-b', 'upstream', r.base);
    r.write('backend/src/other.ts', 'export const o = 1;\n');
    const newBase = r.commit('upstream change');
    r.git('checkout', '-q', '-b', 'rebased', newBase);
    r.write('backend/src/a.ts', 'export const a = 2;\n');
    const rebased = r.commit('feature (rebased)');
    const result = detect(r.root, ['--base', newBase, '--head', rebased, '--since', first]);
    assert.equal(result.run, false, result.reason);
  });
  it('falls back to a full analysis when the previous head is unknown', () => {
    const r = repo();
    r.write('backend/src/a.ts', 'export const a = 2;\n');
    const result = detect(r.root, ['--base', r.base, '--head', r.commit('feature'), '--since', 'f'.repeat(40)]);
    assert.equal(result.run, true);
  });
});
