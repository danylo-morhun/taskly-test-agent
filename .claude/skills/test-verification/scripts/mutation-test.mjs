#!/usr/bin/env node
// Mutation testing with StrykerJS, scoped to the PR's changed lines (or whole files).
// A surviving mutant is a code change the tests did not notice: a concrete hint
// for which assertion is missing.
//
// Usage: node mutation-test.mjs --workspace <name> (--base <ref> [--head <ref>] | --files a,b) [--json-out file]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isMain, list, parseArgs } from '../../../test-agent/lib/args.mjs';
import { classifyPath, getWorkspace, loadConfig, repoRoot, toRepoPath } from '../../../test-agent/lib/config.mjs';
import { toRanges } from '../../../test-agent/lib/diff.mjs';
import { addedLines, changedFiles } from '../../../test-agent/lib/git.mjs';
import { run, tail } from '../../../test-agent/lib/process.mjs';

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

export function mutateSpecs({ workspace, base, head, files, config }) {
  const cwd = join(repoRoot, workspace.root);
  if (files.length) return files.map((file) => relative(cwd, resolve(repoRoot, file)));
  const sources = changedFiles(base, head)
    .filter((file) => file.status !== 'D' && classifyPath(config, file.path).kind === 'source' && classifyPath(config, file.path).workspace === workspace.name)
    .map((file) => file.path);
  if (!sources.length) return [];
  const specs = [];
  for (const [path, lines] of addedLines(base, head, sources)) {
    for (const [start, end] of toRanges(lines)) specs.push(`${relative(cwd, join(repoRoot, path))}:${start}-${end}`);
  }
  return specs;
}

/** Source text covered by a mutant's location (mutation-testing-report-schema: 1-based lines and columns). */
export function originalCode(source, start, end, max = 80) {
  if (typeof source !== 'string') return null;
  const lines = source.split('\n').slice(start.line - 1, end.line);
  if (!lines.length) return null;
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, end.column - 1);
  lines[0] = lines[0].slice(start.column - 1);
  const text = lines.join('\n').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function summarizeMutation(report) {
  const counts = {};
  const survivors = [];
  for (const [file, data] of Object.entries(report.files ?? {})) {
    for (const mutant of data.mutants ?? []) {
      counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
      if (UNDETECTED.has(mutant.status)) {
        const { start, end } = mutant.location ?? {};
        survivors.push({
          file: toRepoPath(resolve(report.projectRoot ?? '', file)) ?? file,
          line: start?.line,
          column: start?.column,
          mutator: mutant.mutatorName,
          original: start && end ? originalCode(data.source, start, end) : null,
          replacement: mutant.replacement ?? null,
          status: mutant.status,
        });
      }
    }
  }
  const detected = Object.entries(counts).filter(([s]) => DETECTED.has(s)).reduce((n, [, c]) => n + c, 0);
  const undetected = Object.entries(counts).filter(([s]) => UNDETECTED.has(s)).reduce((n, [, c]) => n + c, 0);
  const valid = detected + undetected;
  return {
    score: valid ? Math.round((detected / valid) * 1000) / 10 : null,
    detected, undetected, counts,
    survivors: survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
}

export function mutationTest({ workspace: name, base, head, files = [], timeoutMs = 15 * 60_000 }) {
  const config = loadConfig();
  const workspace = getWorkspace(config, name);
  const cwd = join(repoRoot, workspace.root);
  const specs = mutateSpecs({ workspace, base, head, files, config });
  if (!specs.length) return { workspace: name, skipped: true, reason: 'no changed source lines to mutate' };
  const reportFile = join(cwd, 'reports/mutation/mutation.json');
  rmSync(reportFile, { force: true });
  const proc = run('npx', ['stryker', 'run', 'stryker.config.json', '--mutate', specs.join(',')], { cwd, env: workspace.testEnv, timeoutMs });
  if (!existsSync(reportFile)) {
    return { workspace: name, skipped: false, error: `Stryker did not produce a report (exit ${proc.code}).`, output: tail(proc.stdout + proc.stderr, 30) };
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  report.projectRoot ??= cwd;
  return { workspace: name, skipped: false, mutate: specs, durationMs: proc.durationMs, ...summarizeMutation(report) };
}

export function formatMutation(result) {
  if (result.skipped) return `${result.workspace}: mutation testing skipped (${result.reason})`;
  if (result.error) return `${result.workspace}: ${result.error}\n${result.output}`;
  const lines = [`${result.workspace}: mutation score ${result.score ?? 'n/a'}% (${result.detected} detected, ${result.undetected} undetected)`];
  for (const s of result.survivors.slice(0, 30)) {
    const change = s.original !== null && s.original !== undefined ? ` ${JSON.stringify(s.original)} →` : ' →';
    lines.push(`  ${s.status.toUpperCase()} ${s.file}:${s.line}:${s.column ?? 1} ${s.mutator}${s.replacement !== null ? `${change} ${JSON.stringify(s.replacement).slice(0, 80)}` : ''}`);
  }
  if (result.survivors.length > 30) lines.push(`  … and ${result.survivors.length - 30} more`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  if (!args.workspace || (!args.base && !args.files)) {
    console.error('Usage: mutation-test.mjs --workspace <name> (--base <ref> [--head <ref>] | --files a,b) [--json-out file]');
    process.exit(2);
  }
  const result = mutationTest({ workspace: args.workspace, base: args.base, head: args.head, files: list(args.files) });
  if (args['json-out']) {
    mkdirSync(dirname(resolve(args['json-out'])), { recursive: true });
    writeFileSync(args['json-out'], `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(formatMutation(result));
  process.exit(result.error ? 1 : 0);
}
