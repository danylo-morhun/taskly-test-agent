#!/usr/bin/env node
// Runs a workspace's Vitest suite in a sanitized environment and prints a compact,
// agent-friendly summary (counts + failure messages) instead of raw logs.
//
// Usage: node run-tests.mjs --workspace <name> [--files a,b] [--coverage] [--coverage-dir dir]
//                           [--repeat N] [--shuffle] [--json-out file]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { isMain, list, parseArgs } from '../../../test-agent/lib/args.mjs';
import { getWorkspace, loadConfig, repoRoot, toRepoPath } from '../../../test-agent/lib/config.mjs';
import { run, tail } from '../../../test-agent/lib/process.mjs';

function vitestOnce(workspace, { files = [], coverage = false, coverageDir, shuffle = false }) {
  const cwd = join(repoRoot, workspace.root);
  const scratch = mkdtempSync(join(tmpdir(), 'test-agent-'));
  const outputFile = join(scratch, 'vitest.json');
  const args = ['vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`];
  if (coverage) {
    args.push('--coverage.enabled=true');
    if (coverageDir) args.push(`--coverage.reportsDirectory=${resolve(repoRoot, coverageDir)}`);
  }
  if (shuffle) args.push('--sequence.shuffle');
  args.push(...files.map((file) => relative(cwd, resolve(repoRoot, file))));
  const proc = run('npx', args, { cwd, env: workspace.testEnv });
  let report = null;
  try {
    report = JSON.parse(readFileSync(outputFile, 'utf8'));
  } catch {
    // Vitest crashed before writing a report (config error, syntax error in setup, ...).
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return summarize(report, proc);
}

export function summarize(report, proc) {
  if (!report) {
    return { success: false, crashed: true, total: 0, passed: 0, failed: 0, skipped: 0, failures: [], durationMs: proc.durationMs, output: tail(`${proc.stdout}\n${proc.stderr}`) };
  }
  const failures = [];
  const statuses = new Map();
  for (const file of report.testResults ?? []) {
    const path = toRepoPath(file.name) ?? file.name;
    for (const assertion of file.assertionResults ?? []) {
      statuses.set(`${path} > ${assertion.fullName}`, assertion.status);
      if (assertion.status === 'failed') {
        failures.push({ file: path, test: assertion.fullName, message: tail(assertion.failureMessages?.join('\n') ?? '', 25) });
      }
    }
    // Suite-level errors (import/compile failures) have no assertion results.
    if (file.status === 'failed' && !(file.assertionResults ?? []).some((a) => a.status === 'failed')) {
      failures.push({ file: path, test: '(suite failed to run)', message: tail(file.message ?? '', 25) });
    }
  }
  const skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
  // Vitest exits non-zero on coverage threshold failures even when every test passes.
  // Thresholds are a project gate (enforced by CI) and are reported, not treated as failed tests:
  // a PR's own uncovered code must not block valid tests that improve coverage.
  const output = `${proc.stderr}\n${proc.stdout}`;
  const thresholdFailure = proc.code !== 0 && failures.length === 0 && /does not meet (?:global )?threshold/i.test(output);
  // Any other non-zero exit (e.g. unhandled errors/rejections after a test) is a failure.
  const unexplainedExit = proc.code !== 0 && failures.length === 0 && !thresholdFailure;
  if (unexplainedExit) failures.push({ file: '(vitest)', test: `exited with code ${proc.code}`, message: tail(output, 25) });
  return {
    success: failures.length === 0 && (report.numFailedTests ?? 0) === 0 && (report.numFailedTestSuites ?? 0) === 0,
    crashed: false,
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? failures.length,
    skipped,
    failures,
    thresholdFailure: thresholdFailure ? tail(proc.stderr || proc.stdout, 15) : null,
    durationMs: proc.durationMs,
    statuses: Object.fromEntries(statuses),
  };
}

export function runTests(name, options = {}) {
  const workspace = getWorkspace(loadConfig(), name);
  const repeat = Math.max(1, Number(options.repeat ?? 1));
  const runs = [];
  for (let i = 0; i < repeat; i++) runs.push(vitestOnce(workspace, { ...options, coverage: options.coverage && i === 0 }));
  const flakyTests = repeat > 1 ? findFlaky(runs) : [];
  const first = runs[0];
  return {
    workspace: name,
    ...first,
    success: runs.every((r) => r.success),
    repeat,
    flakyTests,
    runs: runs.map(({ success, passed, failed, durationMs }) => ({ success, passed, failed, durationMs })),
  };
}

export function findFlaky(runs) {
  const seen = new Map();
  for (const result of runs) {
    for (const [test, status] of Object.entries(result.statuses ?? {})) {
      if (!seen.has(test)) seen.set(test, new Set());
      seen.get(test).add(status);
    }
  }
  return [...seen].filter(([, statuses]) => statuses.has('passed') && statuses.has('failed')).map(([test]) => test);
}

export function formatSummary(result) {
  const lines = [];
  const icon = result.success ? 'PASS' : 'FAIL';
  if (result.crashed) {
    lines.push(`${icon} ${result.workspace}: Vitest crashed before producing results.`, result.output);
    return lines.join('\n');
  }
  lines.push(`${icon} ${result.workspace}: ${result.passed}/${result.total} passed, ${result.failed} failed, ${result.skipped} skipped (${result.durationMs} ms${result.repeat > 1 ? `, ${result.repeat} runs` : ''})`);
  if (result.flakyTests.length) lines.push(`FLAKY (${result.flakyTests.length}):`, ...result.flakyTests.map((t) => `  - ${t}`));
  if (result.thresholdFailure) lines.push('WARN coverage thresholds not met (non-blocking here; enforced by CI):', result.thresholdFailure);
  for (const failure of result.failures.slice(0, 15)) {
    lines.push('', `✗ ${failure.file} > ${failure.test}`, failure.message.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  if (result.failures.length > 15) lines.push(`… and ${result.failures.length - 15} more failures`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['coverage', 'shuffle'] });
  if (!args.workspace) {
    console.error('Usage: run-tests.mjs --workspace <name> [--files a,b] [--coverage] [--coverage-dir dir] [--repeat N] [--shuffle] [--json-out file]');
    process.exit(2);
  }
  const result = runTests(args.workspace, {
    files: list(args.files), coverage: Boolean(args.coverage), coverageDir: args['coverage-dir'],
    repeat: args.repeat, shuffle: Boolean(args.shuffle),
  });
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    const { statuses, ...serializable } = result;
    writeFileSync(args['json-out'], `${JSON.stringify(serializable, null, 2)}\n`);
  }
  console.log(formatSummary(result));
  process.exit(result.success ? 0 : 1);
}
