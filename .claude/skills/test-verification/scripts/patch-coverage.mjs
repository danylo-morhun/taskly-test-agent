#!/usr/bin/env node
// Patch coverage: share of the PR's changed executable source lines hit by tests.
// Reads lcov produced by `run-tests.mjs --coverage`.
//
// Usage: node patch-coverage.mjs --base <ref> [--head <ref>] [--workspaces a,b] [--lcov-dir dir] [--json-out file]
//   --lcov-dir: directory containing <workspace>/lcov.info (defaults to <root>/coverage/lcov.info)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMain, list, parseArgs } from '../../../test-agent/lib/args.mjs';
import { classifyPath, getWorkspace, loadConfig, repoRoot } from '../../../test-agent/lib/config.mjs';
import { addedLines, changedFiles } from '../../../test-agent/lib/git.mjs';
import { patchCoverage, readLcov } from '../../../test-agent/lib/lcov.mjs';

export function lcovPath(workspace, lcovDir) {
  return lcovDir ? resolve(repoRoot, lcovDir, workspace.name, 'lcov.info') : join(repoRoot, workspace.root, 'coverage', 'lcov.info');
}

export function computePatchCoverage({ base, head, workspaces, lcovDir, config = loadConfig() }) {
  const sources = changedFiles(base, head)
    .filter((file) => file.status !== 'D')
    .map((file) => ({ path: file.path, ...classifyPath(config, file.path) }))
    .filter((file) => file.kind === 'source' && (!workspaces?.length || workspaces.includes(file.workspace)));
  const results = {};
  for (const name of new Set(sources.map((file) => file.workspace))) {
    const workspace = getWorkspace(config, name);
    const paths = sources.filter((file) => file.workspace === name).map((file) => file.path);
    const changed = addedLines(base, head, paths);
    const lcov = lcovPath(workspace, lcovDir);
    if (!existsSync(lcov)) {
      results[name] = { error: `lcov not found: ${lcov}` };
      continue;
    }
    results[name] = patchCoverage(changed, readLcov(lcov, join(repoRoot, workspace.root)));
  }
  return results;
}

export function formatCoverage(results) {
  const lines = [];
  for (const [name, result] of Object.entries(results)) {
    if (result.error) { lines.push(`${name}: ${result.error}`); continue; }
    lines.push(`${name}: patch coverage ${result.percent ?? 'n/a'}% (${result.covered}/${result.total} changed executable lines)`);
    for (const file of result.files) {
      const missed = file.missedLines.length ? ` — uncovered lines: ${file.missedLines.join(', ')}` : '';
      lines.push(`  ${file.path}: ${file.covered}/${file.total}${file.instrumented ? '' : ' (not in coverage report)'}${missed}`);
    }
  }
  return lines.join('\n') || 'No changed source files.';
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.base) {
    console.error('Usage: patch-coverage.mjs --base <ref> [--head <ref>] [--workspaces a,b] [--lcov-dir dir] [--json-out file]');
    process.exit(2);
  }
  const results = computePatchCoverage({ base: args.base, head: args.head, workspaces: list(args.workspaces), lcovDir: args['lcov-dir'] });
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(results, null, 2)}\n`);
  }
  console.log(formatCoverage(results));
}
