#!/usr/bin/env node
// Publishes a test-agent run to the pull request:
//  1. if verification passed and tests changed: push them to `test-agent/pr-<n>`
//     (based on the PR head) and open/update a PR targeting the PR's branch;
//  2. upsert one sticky report comment on the original PR;
//  3. write the report to the job summary.
// Runs from the trusted base checkout; never executes PR code.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MARKER, render } from '../../../.claude/skills/test-report/scripts/render-report.mjs';
import { SHA, gh, ghJson, git, output, required } from './gh.mjs';

const repo = required('REPO');
const number = Number(required('PR_NUMBER'));
const headSha = required('HEAD_SHA');
const headRef = required('HEAD_REF');
const dir = resolve(required('ARTIFACTS_DIR'));
const runUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
const branch = `test-agent/pr-${number}`;
const botLogin = process.env.BOT_LOGIN || 'github-actions[bot]';
const botId = process.env.BOT_ID || '41898282';
if (!SHA.test(headSha)) throw new Error('HEAD_SHA must be a commit SHA');

const read = (name) => {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
};
const detect = (() => { try { return JSON.parse(readFileSync(required('DETECT_FILE'), 'utf8')); } catch { return null; } })();
const report = process.env.REPORT_VALID === 'true' ? read('report.json') : null;
const verification = read('verification.json');
const run = read('run.json');
const patchPath = join(dir, 'tests.patch');
const hasPatch = existsSync(patchPath) && statSync(patchPath).size > 0;
const passed = verification?.status === 'passed';
const reportValid = process.env.REPORT_VALID === 'true';
const auth = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${required('GH_TOKEN')}`).toString('base64')}` };

function openTestPr() {
  return ghJson(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url', '--limit', '1'])?.[0] ?? null;
}

function pushTests() {
  const work = mkdtempSync(join(tmpdir(), 'test-agent-branch-'));
  git(['fetch', '--no-tags', '--depth=1', 'origin', headSha], { env: auth });
  git(['worktree', 'add', '--detach', work, headSha]);
  git(['apply', '--whitespace=nowarn', patchPath], { cwd: work });
  // Defense in depth: re-check the patch against the trusted path policy before committing.
  const policy = execFileSync('node', [resolve('.claude/skills/test-verification/scripts/check-test-policy.mjs')], {
    env: { ...process.env, TEST_AGENT_REPO_ROOT: work }, encoding: 'utf8',
  });
  console.log(policy);
  git(['add', '-A'], { cwd: work });
  const identity = { GIT_AUTHOR_NAME: botLogin, GIT_AUTHOR_EMAIL: `${botId}+${botLogin}@users.noreply.github.com`, GIT_COMMITTER_NAME: botLogin, GIT_COMMITTER_EMAIL: `${botId}+${botLogin}@users.noreply.github.com` };
  git(['commit', '--no-verify', '-m', `test: add unit tests for #${number} (test-agent)`], { cwd: work, env: identity });
  git(['push', '--force', 'origin', `HEAD:refs/heads/${branch}`], { cwd: work, env: auth });
  git(['worktree', 'remove', '--force', work]);

  const files = (verification?.policy?.files ?? []).map((f) => `- \`${f.path}\` (${f.status})`).join('\n');
  const body = [
    `Unit tests proposed by the Test Agent for #${number} at ${headSha.slice(0, 7)}.`,
    '',
    `Merging this PR adds the tests to \`${headRef}\`. Decisions, verification results, coverage and mutation score are in the report comment on #${number}.`,
    '',
    files,
    '',
    `<sub>Workflow run: ${runUrl}. This branch is force-updated on every analysis of #${number}.</sub>`,
  ].join('\n');
  const existing = openTestPr();
  if (existing) {
    gh(['pr', 'edit', String(existing.number), '--repo', repo, '--body', body]);
    return existing.url;
  }
  return gh(['pr', 'create', '--repo', repo, '--base', headRef, '--head', branch, '--title', `test: unit tests for #${number}`, '--body', body]);
}

let testPr = null;
if (passed && reportValid && hasPatch) {
  testPr = pushTests();
} else {
  const stale = openTestPr();
  if (stale && passed && reportValid && !hasPatch) {
    gh(['pr', 'close', String(stale.number), '--repo', repo, '--delete-branch', '--comment', `Superseded: the latest analysis of #${number} (${headSha.slice(0, 7)}) found no tests to propose.`]);
  } else if (stale) {
    testPr = stale.url;
  }
}

const comment = render({
  detect, report, verification, run, runUrl, testPr,
  agentOutcome: process.env.AGENT_OUTCOME,
  patchArtifact: hasPatch && !(passed && reportValid) ? 'test-agent-output / tests.patch' : null,
  // Recorded only after a complete analysis; later pushes diff against it for incremental skips.
  analyzedHead: detect?.run && report && verification ? headSha : null,
});
writeFileSync(join(dir, 'comment.md'), comment);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, comment);

// Only our own bot comments carrying the marker are updated; a user comment that copies the marker is ignored.
const comments = ghJson(['api', '--paginate', '--slurp', `repos/${repo}/issues/${number}/comments?per_page=100`]).flat();
const mine = comments.find((c) => c.user?.type === 'Bot' && c.user?.login === botLogin && String(c.body).startsWith(MARKER));
if (mine && detect && !detect.run && detect.incremental) {
  // Nothing of the PR changed since the last analysis: keep that report instead of replacing it with "Skipped".
  console.log('Incremental skip: keeping the existing report comment.');
} else if (mine) gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, '--input', '-'], { input: JSON.stringify({ body: comment }) });
else gh(['api', '--method', 'POST', `repos/${repo}/issues/${number}/comments`, '--input', '-'], { input: JSON.stringify({ body: comment }) });

output({ 'test-pr': testPr ?? '', status: verification?.status ?? 'none' });
