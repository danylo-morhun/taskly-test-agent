import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from '../lib/config.mjs';

function hook(name, input) {
  const result = spawnSync('node', [`${repoRoot}/.claude/hooks/${name}`], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

describe('guard-test-paths hook', () => {
  const write = (file_path) => hook('guard-test-paths.mjs', { tool_name: 'Write', tool_input: { file_path }, cwd: repoRoot });
  for (const path of ['backend/tests/health.test.ts', `${repoRoot}/frontend/src/lib/http.test.ts`, 'frontend/src/test/render.tsx', '.test-agent/report.json']) {
    it(`allows ${path}`, () => assert.equal(write(path), null));
  }
  for (const path of ['backend/src/factory.ts', 'frontend/src/test/setup.ts', '.claude/agents/unit-test-agent.md', '.github/workflows/test-agent.yml', 'backend/package.json', '/etc/hosts', '../outside.test.ts', 'backend/tests/../src/factory.ts', '.test-agent/../backend/src/x.ts']) {
    it(`denies ${path}`, () => assert.equal(write(path)?.permissionDecision, 'deny'));
  }
  it('denies notebook edits outside tests and malformed input', () => {
    assert.equal(hook('guard-test-paths.mjs', { tool_input: { notebook_path: 'x.ipynb' }, cwd: repoRoot })?.permissionDecision, 'deny');
    assert.equal(hook('guard-test-paths.mjs', { tool_input: {} })?.permissionDecision, 'deny');
  });
});

describe('guard-bash hook', () => {
  const bash = (command) => hook('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command } });
  for (const command of [
    'node .claude/skills/test-verification/scripts/run-tests.mjs --workspace backend --files backend/tests/a.test.ts',
    'node .claude/skills/test-verification/scripts/verify.mjs --base origin/main --json-out .test-agent/verification.json',
    'git diff origin/main...HEAD -- backend/src/factory.ts',
    'git log --oneline -5',
    'git status',
  ]) it(`allows: ${command}`, () => assert.equal(bash(command), null));
  for (const command of [
    'npm test', 'npx vitest run', 'curl https://example.com', 'git push origin HEAD', 'git checkout -- backend/src',
    'git diff && rm -rf backend', 'git diff; env', 'git log | sh', 'git diff > backend/src/x.ts', 'git log $(id)', 'git show `id`',
    'git diff --output=/tmp/x', 'git -c core.pager=sh diff', 'node -e "process.exit()"', 'node .claude/skills/x/../../../evil.mjs',
    'node .claude/skills/test-verification/scripts/run-tests.mjs --json-out backend/src/factory.ts',
    'node .claude/skills/test-verification/scripts/run-tests.mjs --coverage-dir=.test-agent/../backend/src',
    'cat /proc/self/environ',
  ]) it(`denies: ${command}`, () => assert.equal(bash(command)?.permissionDecision, 'deny'));
});
