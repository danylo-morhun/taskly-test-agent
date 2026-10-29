import { execFileSync } from 'node:child_process';
import { repoRoot } from './config.mjs';
import { parseAddedLines, parseNameStatus } from './diff.mjs';

const REF = /^[\w./@^~-]{1,200}$/;

export function assertRef(ref) {
  if (!REF.test(ref) || ref.startsWith('-')) throw new Error(`Refusing suspicious git ref: ${JSON.stringify(ref)}`);
  return ref;
}

export function git(args, { cwd = repoRoot } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

/** Merge-base diff (`base...head`), like a GitHub PR. `head` defaults to the working tree. */
function range(base, head) {
  assertRef(base);
  if (!head) return [git(['merge-base', base, 'HEAD'])];
  return [`${base}...${assertRef(head)}`];
}

export function changedFiles(base, head) {
  return parseNameStatus(git(['diff', '--name-status', '-M', ...range(base, head)]));
}

export function addedLines(base, head, paths = []) {
  return parseAddedLines(git(['diff', '-U0', '--no-color', ...range(base, head), '--', ...paths]));
}

/** Files changed in the working tree relative to HEAD, including untracked files. */
export function workingTreeChanges() {
  const tracked = parseNameStatus(git(['diff', '--name-status', '-M', 'HEAD']));
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
    .map((path) => ({ status: 'A', path }));
  return [...tracked, ...untracked];
}
