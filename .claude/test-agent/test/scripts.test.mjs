import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPolicy, countAssertions, lintTestSource, testTitles } from '../../skills/test-verification/scripts/check-test-policy.mjs';
import { originalCode, summarizeMutation } from '../../skills/test-verification/scripts/mutation-test.mjs';
import { findFlaky, summarize } from '../../skills/test-verification/scripts/run-tests.mjs';
import { MARKER, headline, render } from '../../skills/test-report/scripts/render-report.mjs';
import { summarizeRun } from '../../skills/test-report/scripts/summarize-run.mjs';
import { loadConfig } from '../lib/config.mjs';

const config = loadConfig();
const goodTest = "import { it, expect } from 'vitest'\nit('adds', () => {\n  expect(1 + 1).toBe(2)\n})\n";

describe('test policy', () => {
  it('accepts a real test', () => assert.deepEqual(lintTestSource(goodTest), { errors: [], warnings: [] }));
  it('rejects focused/skipped tests, missing assertions and ts-nocheck', () => {
    const ids = (src) => lintTestSource(src).errors.map((e) => e.id);
    assert.deepEqual(ids(goodTest.replace("it('adds'", "it.only('adds'")), ['focused-or-skipped']);
    assert.deepEqual(ids(goodTest.replace("it('adds'", "describe.skip('x', () => {}); it('adds'")), ['focused-or-skipped']);
    assert.deepEqual(ids(goodTest.replace("it('adds'", "xit('adds'")), ['focused-or-skipped']);
    assert.deepEqual(ids("it('does nothing', () => {})"), ['no-assertions']);
    assert.deepEqual(ids(`// @ts-nocheck\n${goodTest}`), ['ts-nocheck']);
  });
  it('warns about weak or suspicious tests', () => {
    const ids = (src) => lintTestSource(src).warnings.map((w) => w.id);
    assert.deepEqual(ids(`${goodTest}expect(true).toBe(true)`), ['trivial-assertion']);
    assert.deepEqual(ids(`${goodTest}expect(x).toMatchSnapshot()`), ['snapshot']);
    assert.deepEqual(ids(`// @ts-expect-error\n${goodTest}`), ['ts-suppression']);
  });
  it('counts assertions and extracts test titles', () => {
    assert.equal(countAssertions('expect(a); expect.soft(b); expect.assertions(2)'), 3);
    assert.deepEqual([...testTitles("it('a', f); test(\"b\", f); it.each([1])('c %s', f)")], ['a', 'b', 'c %s']);
  });
  const files = { 'backend/tests/new.test.ts': goodTest, 'backend/tests/moved.test.ts': goodTest, 'backend/tests/old.test.ts': "it('kept', () => { expect(sum(1)).toBe(1) })" };
  const head = { 'backend/tests/old.test.ts': "it('kept', () => { expect(sum(1)).toBe(1) })\nit('dropped', () => { expect(sum(2)).toBe(2) })" };
  const run = (changes) => checkPolicy({ config, changes, readFile: (p) => files[p], readHead: (p) => head[p] });
  it('allows added and modified tests, warning about removed cases', () => {
    const result = run([{ status: 'A', path: 'backend/tests/new.test.ts' }, { status: 'M', path: 'backend/tests/old.test.ts' }]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings.map((w) => w.id).sort(), ['fewer-assertions', 'removed-tests']);
    assert.deepEqual(result.files.map((f) => f.status), ['added', 'modified']);
  });
  it('rejects source edits, protected files, deleted tests and renames out of test paths', () => {
    const result = run([
      { status: 'M', path: 'backend/src/factory.ts' },
      { status: 'M', path: 'frontend/src/test/setup.ts' },
      { status: 'D', path: 'backend/tests/old.test.ts' },
      { status: 'R', path: 'backend/tests/moved.test.ts', previousPath: 'backend/src/core/config.ts' },
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => `${e.id}:${e.path}`), [
      'forbidden-path:backend/src/factory.ts',
      'forbidden-path:frontend/src/test/setup.ts',
      'deleted-test:backend/tests/old.test.ts',
      'forbidden-path:backend/src/core/config.ts',
    ]);
  });
});

describe('test runs', () => {
  it('summarizes vitest JSON including suite-level failures', () => {
    const report = {
      success: false, numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0,
      testResults: [
        { name: 'backend/tests/a.test.ts', status: 'failed', assertionResults: [{ fullName: 'a works', status: 'passed' }, { fullName: 'a fails', status: 'failed', failureMessages: ['AssertionError: boom'] }] },
        { name: 'backend/tests/b.test.ts', status: 'failed', message: 'SyntaxError: x', assertionResults: [] },
      ],
    };
    const result = summarize(report, { code: 1, stdout: '', stderr: '', durationMs: 5 });
    assert.equal(result.success, false);
    assert.deepEqual(result.failures.map((f) => f.test), ['a fails', '(suite failed to run)']);
  });
  it('treats a missing report as a crash', () => {
    const result = summarize(null, { code: 1, stdout: 'Error: config', stderr: '', durationMs: 1 });
    assert.equal(result.crashed, true);
    assert.equal(result.success, false);
  });
  it('reports coverage threshold failures without failing passing tests', () => {
    const result = summarize({ success: false, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, testResults: [] }, { code: 1, stdout: '', stderr: 'ERROR: Coverage for lines (50%) does not meet threshold (90%)', durationMs: 1 });
    assert.equal(result.success, true);
    assert.match(result.thresholdFailure, /does not meet threshold/);
  });
  it('flags tests whose outcome differs across runs', () => {
    assert.deepEqual(findFlaky([{ statuses: { a: 'passed', b: 'passed' } }, { statuses: { a: 'failed', b: 'passed' } }]), ['a']);
  });
  it('computes the mutation score from detected vs undetected mutants', () => {
    const result = summarizeMutation({ projectRoot: '/x', files: { 'a.ts': { mutants: [
      { status: 'Killed' }, { status: 'Timeout' }, { status: 'Survived', location: { start: { line: 3 } }, mutatorName: 'EqualityOperator' },
      { status: 'NoCoverage', location: { start: { line: 1 } } }, { status: 'CompileError' },
    ] } } });
    assert.equal(result.score, 50);
    assert.deepEqual(result.survivors.map((s) => s.line), [1, 3]);
  });
});

describe('mutation context', () => {
  it('extracts the mutated source fragment', () => {
    const source = 'const a = 1;\nif (x >= 120) return;\n';
    assert.equal(originalCode(source, { line: 2, column: 5 }, { line: 2, column: 13 }), 'x >= 120');
    assert.equal(originalCode(source, { line: 1, column: 1 }, { line: 2, column: 3 }), 'const a = 1; if');
    assert.equal(originalCode(undefined, { line: 1, column: 1 }, { line: 1, column: 2 }), null);
  });
});

describe('report', () => {
  const detect = { run: true, sources: [{ path: 'backend/src/a.ts' }], tests: [], excluded: [], other: [] };
  const report = {
    summary: 'Adds X. @someone <b>hi</b>',
    decisions: [{ file: 'backend/src/a.ts', workspace: 'backend', action: 'added_tests', reason: 'covers X', testFiles: ['backend/tests/a.test.ts'], testCases: 3 }],
    regressions: [], concerns: [{ file: 'backend/src/a.ts', line: 4, description: 'off by one' }],
    selfCheck: { passed: true, iterations: 2 }, skillsUsed: ['backend-unit-tests'],
  };
  const verification = {
    status: 'passed',
    policy: { ok: true, errors: [], warnings: [], files: [{ path: 'backend/tests/a.test.ts', status: 'added' }] },
    workspaces: { backend: { ok: true, typecheck: { ok: true }, format: { ok: true, skipped: true }, tests: { success: true, passed: 10, total: 10, failures: [] }, flaky: { ok: true, repeats: 3 }, patchCoverage: { before: { percent: 20, covered: 1, total: 5 }, after: { percent: 100, covered: 5, total: 5 } }, mutation: { score: 90, detected: 9, undetected: 1, survivors: [] } } },
  };
  it('chooses a headline from the most important signal', () => {
    assert.equal(headline({ detect: { run: false, reason: 'docs only' } })[1], 'Skipped');
    assert.equal(headline({ detect, report: null, agentOutcome: 'failure' })[1], 'Agent run did not complete');
    assert.equal(headline({ detect, report, verification: { ...verification, status: 'failed' } })[1], 'Generated tests failed verification');
    assert.equal(headline({ detect, report: { ...report, regressions: [{}] }, verification })[1], 'Possible regression detected');
    assert.equal(headline({ detect, report: { ...report, regressions: [{}] }, verification: { ...verification, status: 'failed' } })[1], 'Possible regression detected', 'a regression explains the red suite');
    assert.equal(headline({ detect, report: { ...report, regressions: [{}] }, verification: { ...verification, status: 'failed', policy: { ok: false, files: [] } } })[1], 'Generated tests failed verification', 'policy violations always win');
    assert.equal(headline({ detect, report, verification: { ...verification, policy: { ...verification.policy, files: [] } } })[1], 'No new tests needed');
    assert.equal(headline({ detect, report, verification })[1], 'Tests generated and verified');
  });
  it('renders a sanitized sticky comment with verification metrics', () => {
    const body = render({ detect, report, verification, run: { model: 'm', turns: 5, skillsInvoked: ['test-impact-analysis'], toolCalls: { Read: 3 } }, testPr: 'https://github.com/o/r/pull/2' });
    assert.ok(body.startsWith(MARKER));
    assert.ok(body.includes('20% → **100%** (5/5 lines)'));
    assert.ok(body.includes('90% (9/10)'));
    assert.ok(body.includes('`test-impact-analysis`'));
    assert.ok(!body.includes('<b>hi</b>'));
    assert.ok(!body.includes('@someone'));
  });
  it('explains threshold-only failures and skipped mutation runs', () => {
    const failing = structuredClone(verification);
    Object.assign(failing.workspaces.backend.tests, { success: true, failed: 0, thresholdFailure: 'ERROR: Coverage for lines (80%) does not meet global threshold (95%)' });
    failing.workspaces.backend.mutation = { skipped: true, reason: 'test suite is failing' };
    const body = render({ detect, report, verification: failing });
    assert.ok(body.includes('✅ 10/10 ⚠️ coverage thresholds not met'));
    assert.ok(body.includes('— (test suite is failing)'));
    assert.ok(body.includes('does not meet global threshold'));
  });
});

describe('run summary', () => {
  it('derives skills and tool usage from actual tool calls', () => {
    const summary = summarizeRun([
      { type: 'system', subtype: 'init', model: 'claude-x' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'test-impact-analysis' } }, { type: 'tool_use', name: 'Bash', input: { command: 'node run-tests.mjs' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Permission to use Bash has been denied' }] } },
      { type: 'result', subtype: 'success', num_turns: 4, duration_ms: 1000, total_cost_usd: 0.5, is_error: false },
    ]);
    assert.deepEqual(summary.skillsInvoked, ['test-impact-analysis']);
    assert.deepEqual(summary.toolCalls, { Skill: 1, Bash: 1 });
    assert.equal(summary.deniedToolCalls, 1);
    assert.equal(summary.turns, 4);
    assert.equal(summary.model, 'claude-x');
  });
});

describe('report validation', async () => {
  const { validateReport } = await import('../../skills/test-report/scripts/validate-report.mjs');
  const valid = {
    summary: 's', regressions: [], concerns: [], skillsUsed: ['test-report'],
    selfCheck: { passed: true, iterations: 1 },
    decisions: [{ file: 'backend/src/a.ts', workspace: 'backend', action: 'added_tests', reason: 'r', testFiles: ['backend/tests/a.test.ts'] }],
  };
  const detect = { sources: [{ path: 'backend/src/a.ts' }], omitted: [] };
  it('accepts a complete report', () => assert.deepEqual(validateReport(valid, detect), []));
  it('rejects schema violations', () => {
    const errors = validateReport({ ...valid, extra: 1, selfCheck: { passed: 'yes', iterations: 1 }, decisions: [{ ...valid.decisions[0], action: 'rewrote_code' }] }, detect);
    assert.ok(errors.some((e) => e.includes('$.extra')));
    assert.ok(errors.some((e) => e.includes('selfCheck.passed')));
    assert.ok(errors.some((e) => e.includes('action')));
  });
  it('requires exactly one decision per changed source file', () => {
    const errors = validateReport({ ...valid, decisions: [{ ...valid.decisions[0], file: 'backend/src/other.ts' }] }, detect);
    assert.deepEqual(errors, ['$.decisions: missing a decision for backend/src/a.ts', '$.decisions: backend/src/other.ts is not a changed source file in detect.json']);
  });
  it('requires test files when tests were added', () => {
    assert.deepEqual(validateReport({ ...valid, decisions: [{ ...valid.decisions[0], testFiles: [] }] }, detect), ['$.decisions[backend/src/a.ts]: added_tests requires testFiles']);
  });
});
