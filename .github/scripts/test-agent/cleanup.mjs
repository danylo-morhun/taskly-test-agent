#!/usr/bin/env node
// When a pull request is closed, close its open test-agent PR and delete the branch.
import { gh, ghJson, required } from './gh.mjs';

const repo = required('REPO');
const number = Number(required('PR_NUMBER'));
const branch = `test-agent/pr-${number}`;
const open = ghJson(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number', '--limit', '1'])?.[0];
if (open) {
  gh(['pr', 'close', String(open.number), '--repo', repo, '--delete-branch', '--comment', `Closed because #${number} was closed.`]);
  console.log(`Closed #${open.number} and deleted ${branch}.`);
} else if (gh(['api', '--method', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`], { allowFailure: true }) !== null) {
  console.log(`Deleted ${branch}.`);
} else {
  console.log('Nothing to clean up.');
}
