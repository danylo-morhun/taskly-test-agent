import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { toRepoPath } from './config.mjs';

/** Parses an lcov file into Map<repoPath, Map<line, hits>>. Relative SF paths resolve against `baseDir`. */
export function parseLcov(text, baseDir) {
  const files = new Map();
  let lines = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const sf = line.slice(3);
      const repoPath = toRepoPath(isAbsolute(sf) ? sf : join(baseDir, sf));
      lines = new Map();
      if (repoPath) files.set(repoPath, lines);
    } else if (line.startsWith('DA:') && lines) {
      const [number, hits] = line.slice(3).split(',');
      lines.set(Number(number), Number(hits));
    } else if (line === 'end_of_record') lines = null;
  }
  return files;
}

export function readLcov(path, baseDir) {
  return parseLcov(readFileSync(path, 'utf8'), baseDir);
}

/**
 * Patch coverage: of the changed lines that are executable (present in lcov),
 * how many are hit. Lines absent from lcov (comments, types, blank) are ignored.
 */
export function patchCoverage(changed, coverage) {
  const files = [];
  let covered = 0;
  let total = 0;
  for (const [path, lines] of changed) {
    const fileCoverage = coverage.get(path);
    const executable = fileCoverage ? lines.filter((n) => fileCoverage.has(n)) : [];
    const hit = executable.filter((n) => fileCoverage.get(n) > 0);
    const missed = executable.filter((n) => fileCoverage.get(n) === 0);
    files.push({ path, covered: hit.length, total: executable.length, missedLines: missed, instrumented: Boolean(fileCoverage) });
    covered += hit.length;
    total += executable.length;
  }
  return { covered, total, percent: total ? round((covered / total) * 100) : null, files };
}

export function round(value) {
  return Math.round(value * 10) / 10;
}
