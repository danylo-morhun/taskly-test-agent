#!/usr/bin/env node
// Full, deterministic verification of generated tests. Used by the agent as a
// final self-check and by the CI `verify` job (which does not trust the agent).
//
// Checks, per affected workspace: path/quality policy, typecheck, formatting of
// changed tests, full test run with coverage, repeated shuffled runs of changed
// tests (flakiness), patch coverage before/after and, optionally, mutation score.
//
// Usage: node verify.mjs --base <ref> [--head <ref>] [--workspaces a,b] [--baseline-dir dir]
//                        [--mutation] [--json-out file]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isMain, list, parseArgs } from '../../../test-agent/lib/args.mjs';
import { classifyPath, getWorkspace, loadConfig, repoRoot } from '../../../test-agent/lib/config.mjs';
import { changedFiles } from '../../../test-agent/lib/git.mjs';
import { run, tail } from '../../../test-agent/lib/process.mjs';
import { TEST_FILE, checkPolicy, formatPolicy } from './check-test-policy.mjs';
import { mutationTest, formatMutation } from './mutation-test.mjs';
import { computePatchCoverage, formatCoverage } from './patch-coverage.mjs';
import { formatSummary, runTests } from './run-tests.mjs';

function command(workspace, argv) {
  const [cmd, ...args] = argv;
  const proc = run(cmd, args, { cwd: join(repoRoot, workspace.root), env: workspace.testEnv });
  return { ok: proc.code === 0, durationMs: proc.durationMs, output: proc.code === 0 ? '' : tail(proc.stdout + proc.stderr, 30) };
}

export function verify({ base, head, workspaces: requested = [], baselineDir, mutation = false, log = console.log }) {
  const config = loadConfig();
  const policy = checkPolicy({ config });
  log(formatPolicy(policy));
  const changedTests = policy.files.map((file) => file.path);
  const prFiles = changedFiles(base, head).map((file) => ({ ...file, ...classifyPath(config, file.path) }));
  const affected = new Set(requested);
  if (!requested.length) {
    for (const file of [...prFiles, ...policy.files.map((f) => ({ path: f.path, ...classifyPath(config, f.path) }))]) {
      if (file.workspace && (file.kind === 'source' || file.kind === 'test')) affected.add(file.workspace);
    }
  }

  const results = {};
  for (const name of affected) {
    const workspace = getWorkspace(config, name);
    const ownTests = changedTests.filter((path) => path.startsWith(`${workspace.root}/`));
    const result = {};
    result.typecheck = workspace.typecheck ? command(workspace, workspace.typecheck) : { ok: true, skipped: true };
    log(`${result.typecheck.ok ? 'PASS' : 'FAIL'} ${name}: typecheck${result.typecheck.output ? `\n${result.typecheck.output}` : ''}`);
    const toFormat = ownTests.map((path) => relative(join(repoRoot, workspace.root), join(repoRoot, path)));
    result.format = workspace.format && toFormat.length ? command(workspace, [...workspace.format, ...toFormat]) : { ok: true, skipped: true };
    if (!result.format.skipped) log(`${result.format.ok ? 'PASS' : 'FAIL'} ${name}: formatting of changed tests${result.format.output ? `\n${result.format.output}` : ''}`);

    const tests = runTests(name, { coverage: true });
    log(formatSummary(tests));
    const { statuses, ...serializable } = tests;
    result.tests = serializable;

    const repeats = config.limits?.flakyRepeats ?? 3;
    const specFiles = ownTests.filter((path) => TEST_FILE.test(path));
    if (specFiles.length && repeats > 1) {
      const flaky = runTests(name, { files: specFiles, repeat: repeats, shuffle: true });
      result.flaky = { ok: flaky.success && !flaky.flakyTests.length, repeats, files: specFiles, flakyTests: flaky.flakyTests, failures: flaky.failures.slice(0, 5) };
      log(`${result.flaky.ok ? 'PASS' : 'FAIL'} ${name}: ${repeats}× shuffled re-runs of ${specFiles.length} changed test file(s)${flaky.flakyTests.length ? ` — flaky: ${flaky.flakyTests.join('; ')}` : ''}`);
    } else {
      result.flaky = { ok: true, skipped: true };
    }

    const after = computePatchCoverage({ base, head, workspaces: [name], config })[name] ?? null;
    const before = baselineDir ? computePatchCoverage({ base, head, workspaces: [name], lcovDir: baselineDir, config })[name] ?? null : null;
    result.patchCoverage = { before, after };
    if (after) log(formatCoverage({ [name]: after }));

    if (mutation && tests.success) {
      result.mutation = mutationTest({ workspace: name, base, head });
      log(formatMutation(result.mutation));
    } else if (mutation) {
      // Stryker needs a green initial run; mutation scores on a failing suite are meaningless.
      result.mutation = { workspace: name, skipped: true, reason: 'test suite is failing' };
    }
    result.ok = result.typecheck.ok && result.format.ok && tests.success && result.flaky.ok;
    results[name] = result;
  }

  const ok = policy.ok && Object.values(results).every((r) => r.ok);
  return { status: ok ? 'passed' : 'failed', base, head: head ?? 'WORKTREE', policy, workspaces: results };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['mutation'] });
  if (!args.base) {
    console.error('Usage: verify.mjs --base <ref> [--head <ref>] [--workspaces a,b] [--baseline-dir dir] [--mutation] [--json-out file]');
    process.exit(2);
  }
  const result = verify({ base: args.base, head: args.head, workspaces: list(args.workspaces), baselineDir: args['baseline-dir'], mutation: Boolean(args.mutation) });
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(`\nVerification ${result.status.toUpperCase()}`);
  process.exit(result.status === 'passed' ? 0 : 1);
}
