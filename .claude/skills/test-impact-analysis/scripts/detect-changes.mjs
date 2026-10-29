#!/usr/bin/env node
// Deterministic first pass over a PR: which changed files are testable source,
// which workspaces are affected, and whether the agent needs to run at all.
//
// Usage: node detect-changes.mjs --base <ref> [--head <ref>] [--since <ref>] [--out file.json] [--github-output]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isMain, parseArgs } from '../../../test-agent/lib/args.mjs';
import { classifyPath, loadConfig } from '../../../test-agent/lib/config.mjs';
import { addedLines, changedFiles, git } from '../../../test-agent/lib/git.mjs';

export function detect({ base, head, since, config = loadConfig() }) {
  const files = changedFiles(base, head).map((file) => ({ ...file, ...classifyPath(config, file.path) }));
  const live = files.filter((file) => file.status !== 'D');
  const sourceFiles = live.filter((file) => file.kind === 'source');
  const lines = sourceFiles.length ? addedLines(base, head, sourceFiles.map((file) => file.path)) : new Map();
  const sources = sourceFiles.map(({ path, status, workspace }) => ({ path, status, workspace, changedLines: lines.get(path)?.length ?? 0 }));
  const max = config.limits?.maxSourceFiles ?? Infinity;
  // Prioritize the biggest changes when a PR exceeds the per-run budget.
  const ranked = [...sources].sort((a, b) => b.changedLines - a.changedLines);
  const selected = ranked.slice(0, max);
  const omitted = ranked.slice(max).map((file) => file.path);
  const pick = (kind) => live.filter((file) => file.kind === kind).map((file) => file.path);
  const result = {
    base, head: head ?? 'WORKTREE',
    run: false,
    reason: '',
    workspaces: [...new Set(selected.map((file) => file.workspace))],
    testWorkspaces: [...new Set(files.filter((file) => file.kind === 'test').map((file) => file.workspace))],
    sources: selected.sort((a, b) => a.path.localeCompare(b.path)),
    omitted,
    tests: pick('test'),
    excluded: pick('excluded'),
    other: pick('other'),
    deletedSources: files.filter((file) => file.status === 'D' && file.kind === 'source').map((file) => file.path),
  };
  if (!sources.length) {
    result.reason = files.length
      ? `No testable source changes (${files.length} changed file(s): tests, config, docs or coverage-excluded code).`
      : 'No changes.';
    return result;
  }
  if (since) {
    let incremental = null;
    try {
      incremental = changedFiles(since, head).map((file) => classifyPath(config, file.path).kind);
    } catch {
      // `since` may be unreachable after a force-push: fall back to analyzing the whole PR.
    }
    if (incremental && incremental.length && !incremental.includes('source')) {
      result.reason = 'Only tests or non-source files changed since the last analyzed commit.';
      return result;
    }
  }
  result.run = true;
  result.reason = `${sources.length} testable source file(s) changed in ${result.workspaces.join(', ')}.`;
  return result;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['github-output'] });
  if (!args.base) {
    console.error('Usage: detect-changes.mjs --base <ref> [--head <ref>] [--since <ref>] [--out file] [--github-output]');
    process.exit(2);
  }
  if (args.since && /^0+$/.test(args.since)) delete args.since;
  const result = detect({ base: args.base, head: args.head, since: args.since });
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (args['github-output'] && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `run=${result.run}`,
      `workspaces=${JSON.stringify(result.workspaces)}`,
      `test-workspaces=${JSON.stringify([...new Set([...result.workspaces, ...result.testWorkspaces])])}`,
      `reason=${result.reason}`,
      `head-sha=${args.head ? git(['rev-parse', args.head]) : ''}`,
    ].join('\n') + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
}
