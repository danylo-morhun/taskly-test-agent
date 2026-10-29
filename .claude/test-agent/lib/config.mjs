import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from './glob.mjs';

/** Checkout that provides this tooling and its config (in CI: the trusted base branch). */
export const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Checkout under test. Defaults to the tooling checkout; CI points it at the untrusted PR head. */
export const repoRoot = resolve(process.env.TEST_AGENT_REPO_ROOT || toolRoot);

export function loadConfig(path = join(toolRoot, '.claude/test-agent/config.json')) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(config.workspaces) || !config.workspaces.length) {
    throw new Error(`Invalid test-agent config: no workspaces in ${path}`);
  }
  return config;
}

/** Normalizes an absolute or relative path to a repo-relative POSIX path, or null if outside. */
export function toRepoPath(path, root = repoRoot) {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(root, absolute);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

export function findWorkspace(config, repoPath) {
  return config.workspaces.find((ws) => repoPath.startsWith(`${ws.root}/`)) ?? null;
}

/**
 * Classifies a repo-relative path:
 * - `test`: a test or test helper file the agent may write
 * - `source`: production code that should be covered by unit tests
 * - `excluded`: production code the project deliberately excludes from coverage
 * - `other`: config, docs, styles, lockfiles, ...
 */
export function classifyPath(config, repoPath) {
  const workspace = findWorkspace(config, repoPath);
  if (!workspace) return { kind: 'other', workspace: null };
  if (matchesAny(repoPath, workspace.tests)) return { kind: 'test', workspace: workspace.name };
  if (matchesAny(repoPath, workspace.sources)) {
    const kind = matchesAny(repoPath, workspace.excludeSources) ? 'excluded' : 'source';
    return { kind, workspace: workspace.name };
  }
  return { kind: 'other', workspace: workspace.name };
}

/** True when the agent is allowed to create or modify this path. */
export function isWritableTestPath(config, repoPath) {
  if (!repoPath) return false;
  const workspace = findWorkspace(config, repoPath);
  if (!workspace) return false;
  return matchesAny(repoPath, workspace.tests) && !matchesAny(repoPath, workspace.protected ?? []);
}

export function getWorkspace(config, name) {
  const workspace = config.workspaces.find((ws) => ws.name === name);
  if (!workspace) throw new Error(`Unknown workspace "${name}". Known: ${config.workspaces.map((ws) => ws.name).join(', ')}`);
  return workspace;
}
