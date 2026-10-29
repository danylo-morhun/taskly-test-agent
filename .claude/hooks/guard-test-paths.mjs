#!/usr/bin/env node
// PreToolUse hook for the unit-test agent: file writes are allowed only to test
// files and test helpers declared in .claude/test-agent/config.json.
// The git-ignored scratch directory .test-agent/ is also writable (report output).
// Symlinks are resolved so a link inside tests/ cannot redirect a write to source.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isWritableTestPath, loadConfig, repoRoot, toRepoPath } from '../test-agent/lib/config.mjs';

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function resolveReal(path) {
  if (existsSync(path)) return realpathSync(path);
  // New file: resolve the closest existing ancestor, keep the rest.
  const parent = dirname(path);
  if (parent === path) return path;
  return join(resolveReal(parent), basename(path));
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  deny('Test agent guard: could not parse hook input.');
}
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) deny('Test agent guard: write without a file path.');

const root = realpathSync(process.env.CLAUDE_PROJECT_DIR || repoRoot);
const absolute = resolveReal(target.startsWith('/') ? target : join(input.cwd || root, target));
const repoPath = toRepoPath(absolute, root);
// The agent's scratch directory (report, run artifacts) is git-ignored and never proposed.
// detect.json and pr-context.md are inputs prepared by the workflow: read-only for the agent.
if (/^\.test-agent\/(?:detect\.json|pr-context\.md|context\.json)$/.test(repoPath ?? '')) {
  deny('Test agent policy: workflow inputs in .test-agent/ (detect.json, pr-context.md) are read-only.');
}
if (repoPath?.startsWith('.test-agent/') && !repoPath.includes('..')) process.exit(0);
if (!isWritableTestPath(loadConfig(join(root, '.claude/test-agent/config.json')), repoPath)) {
  deny(`Test agent policy: "${repoPath ?? target}" is not a writable test path. The agent may only create or edit test files and test helpers (see .claude/test-agent/config.json). Production code must not be changed — report suspected bugs as concerns instead.`);
}
process.exit(0);
