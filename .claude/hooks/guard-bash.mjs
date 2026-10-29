#!/usr/bin/env node
// PreToolUse hook for the unit-test agent: Bash is limited to the skill scripts
// and read-only git inspection. No chaining, redirection or substitution, so an
// allowed prefix cannot smuggle a second command.
import { readFileSync } from 'node:fs';

const ALLOWED = [
  /^node \.claude\/skills\/[a-z0-9-]+\/scripts\/[a-z0-9-]+\.mjs(?: |$)/,
  /^git (?:diff|log|show|status|ls-files|merge-base|rev-parse|blame)(?: |$)/,
];
const FORBIDDEN_SYNTAX = /[;&|<>`\n\r]|\$\(|\$\{/;
const FORBIDDEN_GIT_FLAGS = /\s--(?:output|ext-diff|exec|upload-pack|config-env)\b|\s-c\s/;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

let command = '';
try {
  command = String(JSON.parse(readFileSync(0, 'utf8')).tool_input?.command ?? '').trim();
} catch {
  deny('Test agent guard: could not parse hook input.');
}
if (FORBIDDEN_SYNTAX.test(command)) {
  deny('Test agent policy: shell chaining, pipes, redirection and substitution are not allowed. Run one command at a time; the skill scripts already capture and summarize output.');
}
if (!ALLOWED.some((pattern) => pattern.test(command)) || FORBIDDEN_GIT_FLAGS.test(command)) {
  deny('Test agent policy: only the skill scripts (node .claude/skills/<skill>/scripts/<script>.mjs ...) and read-only git commands (diff, log, show, status, ls-files, merge-base, rev-parse, blame) are allowed. Use Read/Grep/Glob for files.');
}
// Script output paths must stay inside the scratch directory.
for (const match of command.matchAll(/--(?:json-out|out|coverage-dir|lcov-dir|baseline-dir)(?:=|\s+)(\S+)/g)) {
  const path = match[1].replace(/^\.\//, '');
  if (!path.startsWith('.test-agent/') || path.includes('..') || /^\.test-agent\/(?:detect\.json|pr-context\.md|context\.json)$/.test(path)) {
    deny(`Test agent policy: output path "${match[1]}" must be inside .test-agent/.`);
  }
}
process.exit(0);
