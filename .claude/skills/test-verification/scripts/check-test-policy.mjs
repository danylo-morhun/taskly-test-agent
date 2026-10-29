#!/usr/bin/env node
// Guards the agent's output (working tree vs HEAD): it may only add or modify test
// files, must not delete tests, and the tests it writes must be real tests.
//
// Usage: node check-test-policy.mjs [--json-out file]
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMain, parseArgs } from '../../../test-agent/lib/args.mjs';
import { isWritableTestPath, loadConfig, repoRoot } from '../../../test-agent/lib/config.mjs';
import { git, workingTreeChanges } from '../../../test-agent/lib/git.mjs';

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const ERROR_RULES = [
  { id: 'focused-or-skipped', pattern: /\b(?:it|test|describe|suite)\s*\.\s*(?:only|skip|todo|fails)\b|\b(?:fit|xit|fdescribe|xdescribe|xtest)\s*\(/, message: 'focused, skipped or todo tests (.only/.skip/.todo) are not allowed' },
  { id: 'ts-nocheck', pattern: /@ts-nocheck/, message: '@ts-nocheck disables type checking for the whole file' },
  { id: 'real-network', pattern: /\bfetch\s*\(\s*['"`]https?:\/\//, message: 'tests must not call real network endpoints' },
];

const WARNING_RULES = [
  { id: 'ts-suppression', pattern: /@ts-(?:ignore|expect-error)/, message: 'TypeScript error suppression' },
  { id: 'trivial-assertion', pattern: /expect\(\s*(?:true|false|1|0|null|undefined)\s*\)/, message: 'assertion on a literal value is always true or always false' },
  { id: 'snapshot', pattern: /toMatch(?:Inline)?Snapshot\(/, message: 'snapshot assertions are weak unit-test oracles; prefer explicit expectations' },
  { id: 'console', pattern: /console\.(?:log|debug)\(/, message: 'leftover console output' },
];

export function countAssertions(source) {
  return (source.match(/\bexpect(?:\.soft)?\s*\(|\bexpect\.assertions\s*\(|\bassert\w*\s*\(/g) ?? []).length;
}

export function testTitles(source) {
  const titles = new Set();
  for (const match of source.matchAll(/\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) titles.add(match[2]);
  return titles;
}

export function lintTestSource(source) {
  const errors = ERROR_RULES.filter((rule) => rule.pattern.test(source)).map(({ id, message }) => ({ id, message }));
  const warnings = WARNING_RULES.filter((rule) => rule.pattern.test(source)).map(({ id, message }) => ({ id, message }));
  if (countAssertions(source) === 0) errors.push({ id: 'no-assertions', message: 'test file contains no assertions' });
  return { errors, warnings };
}

/**
 * Inside the agent's CI sandbox (TEST_AGENT_SANDBOX=1, set only for the agent job) two kinds of
 * changes are not the agent's: `.claude/` restored from the base branch by claude-code-action,
 * and empty placeholder files the bubblewrap sandbox mounts at the repo root. They are ignored
 * there, and only there: the independent verify and publish checks stay strict.
 */
export function isSandboxArtifact(change, size = (p) => statSync(join(repoRoot, p)).size) {
  if (/^\.claude(?:-pr)?\//.test(change.path)) return true;
  if (change.status !== 'A' || change.path.includes('/')) return false;
  try {
    return size(change.path) === 0;
  } catch {
    return false;
  }
}

export function checkPolicy({ config = loadConfig(), changes = workingTreeChanges(), readFile = (p) => readFileSync(join(repoRoot, p), 'utf8'), readHead = (p) => git(['show', `HEAD:${p}`]), sandbox = process.env.TEST_AGENT_SANDBOX === '1', size } = {}) {
  const errors = [];
  const warnings = [];
  const files = [];
  const ignored = [];
  for (const change of changes) {
    if (sandbox && isSandboxArtifact(change, size)) {
      ignored.push(change.path);
      continue;
    }
    const { status, path } = change;
    if (change.previousPath && !isWritableTestPath(config, change.previousPath)) {
      errors.push({ path: change.previousPath, id: 'forbidden-path', message: 'renamed a file outside the allowed test paths' });
    }
    if (!isWritableTestPath(config, path)) {
      errors.push({ path, id: 'forbidden-path', message: 'only test files and test helpers may be created or modified' });
      continue;
    }
    if (status === 'D') {
      errors.push({ path, id: 'deleted-test', message: 'existing tests must not be deleted' });
      continue;
    }
    const entry = { path, status: status === 'A' ? 'added' : 'modified' };
    files.push(entry);
    if (!TEST_FILE.test(path)) continue;
    const source = readFile(path);
    const lint = lintTestSource(source);
    errors.push(...lint.errors.map((e) => ({ path, ...e })));
    warnings.push(...lint.warnings.map((w) => ({ path, ...w })));
    entry.assertions = countAssertions(source);
    if (status === 'M') {
      const before = readHead(path);
      entry.assertionsBefore = countAssertions(before);
      const removed = [...testTitles(before)].filter((title) => !testTitles(source).has(title));
      if (removed.length) {
        warnings.push({ path, id: 'removed-tests', message: `existing test cases were removed or renamed: ${removed.slice(0, 5).join('; ')}` });
      }
      if (entry.assertions < entry.assertionsBefore) {
        warnings.push({ path, id: 'fewer-assertions', message: `assertions reduced from ${entry.assertionsBefore} to ${entry.assertions}` });
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, files, ...(sandbox ? { ignoredSandboxArtifacts: ignored } : {}) };
}

export function formatPolicy(result) {
  const lines = [`${result.ok ? 'PASS' : 'FAIL'} policy: ${result.files.length} test file(s) changed, ${result.errors.length} error(s), ${result.warnings.length} warning(s)`];
  for (const e of result.errors) lines.push(`  ERROR ${e.path}: ${e.message}`);
  for (const w of result.warnings) lines.push(`  WARN  ${w.path}: ${w.message}`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const result = checkPolicy();
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(formatPolicy(result));
  process.exit(result.ok ? 0 : 1);
}

