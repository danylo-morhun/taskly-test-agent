#!/usr/bin/env node
// Renders the sticky PR comment from: deterministic change detection, the agent's
// structured report (untrusted, sanitized) and the independent CI verification.
//
// Usage: node render-report.mjs --detect detect.json [--report report.json] [--verification verification.json]
//        [--run run.json] [--agent-outcome success|failure|skipped] [--run-url url] [--test-pr url]
//        [--patch-artifact name] [--out comment.md]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isMain, parseArgs } from '../../../test-agent/lib/args.mjs';
import { code, sanitizeInline as text } from '../../../test-agent/lib/markdown.mjs';

export const MARKER = '<!-- taskly-test-agent:report -->';

const ACTIONS = {
  added_tests: '🆕 added tests',
  updated_tests: '✏️ updated tests',
  no_tests_needed: '— no tests needed',
  skipped: '⏭️ skipped',
};

const mark = (ok) => (ok ? '✅' : '❌');
const pct = (value) => (value === null || value === undefined ? 'n/a' : `${value}%`);

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function headline({ detect, report, verification, agentOutcome, testPr }) {
  if (!detect?.run) return ['⏭️', 'Skipped', text(detect?.reason ?? 'Nothing to analyze.')];
  if (!report || agentOutcome === 'failure') return ['⚠️', 'Agent run did not complete', 'No tests were proposed. See the workflow run for details.'];
  if (!verification) return ['⚠️', 'Verification did not run', 'Generated tests were not verified and are not proposed.'];
  const changed = verification.policy?.files?.length ?? 0;
  if (verification.status !== 'passed') return ['❌', 'Generated tests failed verification', 'The tests are not proposed for merge. The patch is attached to the workflow run for inspection.'];
  if (report.regressions?.length) return ['⚠️', 'Possible regression detected', 'Existing tests fail because of this PR — see below. They were intentionally not modified.'];
  if (!changed) return ['✅', 'No new tests needed', 'Existing tests already cover the changes, or the changes are not unit-testable.'];
  return ['✅', 'Tests generated and verified', testPr ? `Review and merge the proposed tests: ${testPr}` : 'Apply the patch from the workflow run artifacts.'];
}

export function render({ detect, report, verification, run, agentOutcome, runUrl, testPr, patchArtifact }) {
  const [icon, title, subtitle] = headline({ detect, report, verification, agentOutcome, testPr });
  const out = [MARKER, `## ${icon} Test Agent — ${title}`, '', subtitle, ''];
  if (report?.summary) out.push(`> ${text(report.summary, 600)}`, '');

  if (detect?.run && report?.decisions?.length) {
    out.push('### Decisions', '', '| Source file | Decision | Tests | Reason |', '| --- | --- | --- | --- |');
    for (const d of report.decisions) {
      const tests = d.testFiles?.length ? d.testFiles.map((f) => code(f)).join('<br>') : '—';
      const cases = d.testCases ? ` (${Number(d.testCases)})` : '';
      out.push(`| ${code(d.file)} | ${ACTIONS[d.action] ?? text(d.action)}${cases} | ${tests} | ${text(d.reason, 250)} |`);
    }
    out.push('');
  }

  if (report?.regressions?.length) {
    out.push('### ⚠️ Possible regressions', '', 'These pre-existing tests fail with the PR\'s changes. The agent does not rewrite assertions to match new behavior — confirm the change is intended, then update the tests yourself.', '');
    for (const r of report.regressions) out.push(`- ${code(r.test)} (${code(r.sourceFile)}): ${text(r.explanation, 400)}`);
    out.push('');
  }

  if (report?.concerns?.length) {
    out.push('### 🔎 Concerns found while testing', '');
    for (const c of report.concerns) out.push(`- ${code(c.line ? `${c.file}:${Number(c.line)}` : c.file)}: ${text(c.description, 400)}`);
    out.push('');
  }

  if (verification) {
    out.push('### Independent verification', '', '_Re-run in a separate job without the agent and without secrets._', '');
    const policy = verification.policy ?? { ok: false, errors: [], warnings: [], files: [] };
    out.push(`- ${mark(policy.ok)} **Policy**: ${policy.files.length} test file(s) changed, only test paths touched${policy.errors.length ? ` — ${policy.errors.length} violation(s)` : ''}`);
    for (const e of policy.errors.slice(0, 10)) out.push(`  - ❌ ${code(e.path)}: ${text(e.message)}`);
    for (const w of policy.warnings.slice(0, 10)) out.push(`  - ⚠️ ${code(w.path)}: ${text(w.message)}`);
    out.push('');
    const rows = Object.entries(verification.workspaces ?? {});
    if (rows.length) {
      out.push('| Workspace | Typecheck | Tests | Flakiness | Patch coverage (before → after) | Mutation score |', '| --- | --- | --- | --- | --- | --- |');
      for (const [name, ws] of rows) {
        const t = ws.tests ?? {};
        const tests = t.crashed ? '❌ crashed' : `${mark(t.success)} ${t.passed}/${t.total}`;
        const flaky = ws.flaky?.skipped ? '—' : `${mark(ws.flaky?.ok)} ${ws.flaky?.repeats}× shuffled`;
        const after = ws.patchCoverage?.after;
        const before = ws.patchCoverage?.before;
        const coverage = after && !after.error ? `${before && !before.error ? `${pct(before.percent)} → ` : ''}**${pct(after.percent)}** (${after.covered}/${after.total} lines)` : 'n/a';
        const m = ws.mutation;
        const mutation = !m ? '—' : m.skipped ? '—' : m.error ? '⚠️ error' : `${pct(m.score)} (${m.detected}/${m.detected + m.undetected})`;
        out.push(`| ${name} | ${mark(ws.typecheck?.ok)} | ${tests} | ${flaky} | ${coverage} | ${mutation} |`);
      }
      out.push('');
      for (const [name, ws] of rows) {
        const failures = [...(ws.tests?.failures ?? [])].slice(0, 5);
        if (failures.length || ws.typecheck?.output || ws.format?.output) {
          out.push(`<details><summary>${name}: failure details</summary>`, '', '```text');
          if (ws.typecheck?.output) out.push(ws.typecheck.output.replace(/```/g, "'''").slice(0, 3000));
          if (ws.format?.output) out.push(ws.format.output.replace(/```/g, "'''").slice(0, 1500));
          for (const f of failures) out.push(`✗ ${f.file} > ${f.test}`, f.message.replace(/```/g, "'''").slice(0, 1500));
          out.push('```', '', '</details>', '');
        }
        const survivors = ws.mutation?.survivors ?? [];
        if (survivors.length) {
          out.push(`<details><summary>${name}: ${survivors.length} undetected mutant(s)</summary>`, '', '| Location | Mutator | Status |', '| --- | --- | --- |');
          for (const s of survivors.slice(0, 25)) out.push(`| ${code(`${s.file}:${s.line}`)} | ${text(s.mutator)} | ${text(s.status)} |`);
          out.push('', '</details>', '');
        }
      }
    }
  }

  if (detect) {
    const scope = [
      `${detect.sources?.length ?? 0} testable source file(s)`,
      detect.tests?.length ? `${detect.tests.length} test file(s)` : null,
      detect.excluded?.length ? `${detect.excluded.length} coverage-excluded` : null,
      detect.other?.length ? `${detect.other.length} other` : null,
    ].filter(Boolean).join(', ');
    out.push('<details><summary>Run details</summary>', '');
    out.push(`- **Scope**: ${scope}${detect.omitted?.length ? ` — ${detect.omitted.length} file(s) over the per-run budget were not analyzed` : ''}`);
    if (run) {
      out.push(`- **Agent**: ${code('unit-test-agent')}${run.model ? ` on ${code(run.model)}` : ''}, ${run.turns ?? '?'} turns, ${run.durationMs ? `${Math.round(run.durationMs / 1000)} s` : '?'}${run.costUsd ? `, $${run.costUsd.toFixed(2)}` : ''}`);
      out.push(`- **Skills invoked**: ${run.skillsInvoked?.length ? run.skillsInvoked.map((s) => code(s)).join(', ') : 'none recorded'}`);
      const tools = Object.entries(run.toolCalls ?? {}).map(([k, v]) => `${k}×${v}`).join(', ');
      if (tools) out.push(`- **Tool calls**: ${text(tools)}${run.deniedToolCalls ? ` (${run.deniedToolCalls} blocked by policy)` : ''}`);
    }
    if (report?.selfCheck) out.push(`- **Agent self-check**: ${mark(report.selfCheck.passed)} after ${Number(report.selfCheck.iterations)} iteration(s)`);
    if (patchArtifact) out.push(`- **Patch artifact**: ${code(patchArtifact)}`);
    if (runUrl) out.push(`- **Workflow run**: ${runUrl}`);
    out.push('', '</details>', '');
  }
  out.push('<sub>Generated by the Test Agent workflow. Re-run: push a commit or run the workflow manually. Opt out: add the <code>test-agent:skip</code> label.</sub>');
  return `${out.join('\n')}\n`;
}

if (isMain(import.meta.url)) {
  const args = parseArgs();
  const body = render({
    detect: readJson(args.detect),
    report: readJson(args.report),
    verification: readJson(args.verification),
    run: readJson(args.run),
    agentOutcome: args['agent-outcome'],
    runUrl: args['run-url'],
    testPr: args['test-pr'],
    patchArtifact: args['patch-artifact'],
  });
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, body);
  }
  process.stdout.write(body);
}
