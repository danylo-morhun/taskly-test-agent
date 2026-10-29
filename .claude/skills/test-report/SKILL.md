---
name: test-report
description: Produces the structured, machine-validated result of a test-generation run (decisions per file, regressions, concerns, self-check) and renders it as a pull-request comment. Use as the final step of a test-generation task.
license: MIT
compatibility: Node.js >= 22. The report must validate against report.schema.json.
metadata:
  version: "1.0.0"
---

# Test report

The report is consumed by automation (`render-report.mjs`, the PR workflow), not just people. Precision beats prose.

## Contract

Write the report with the Write tool to **`.test-agent/report.json`**: a single JSON object matching [report.schema.json](report.schema.json). Then validate it:

```bash
node .claude/skills/test-report/scripts/validate-report.mjs --report .test-agent/report.json [--detect <detect.json from the task>]
```

Fix every reported error and re-validate until it prints `VALID`. CI runs the same validation. An invalid report counts as a failed run, and no tests are proposed.

| Field | Rules |
| --- | --- |
| `summary` | 1–2 sentences: what the change does and what you did about tests. No marketing. |
| `decisions` | **Exactly one entry per file in `detect.sources`** (plus `omitted` files as `skipped`). `testFiles` = repo-relative test files you created/modified for it; `testCases` = cases added or changed. `reason` is concrete: the behaviors covered (`"404 on missing id, 422 on invalid id, success path"`) or why no test is warranted (`"type-only change"`). |
| `regressions` | Pre-existing tests failing because of the PR, left untouched. Empty array if none. |
| `concerns` | Suspected bugs or risky behavior in the PR's production code, with `line` when known. Empty array if none. Do not pad. |
| `selfCheck` | `passed` = whether the last `verify.mjs` printed `Verification PASSED`; `iterations` = write→run→fix cycles; `mutationScore` if measured; `notes` for equivalent mutants or remaining gaps. |
| `skillsUsed` | Names of the skills you invoked, in order. |

Honesty rules: never claim tests pass that you did not run; if the self-check failed, set `passed: false` and explain in `notes`. CI re-verifies independently — a false claim is detected and shown next to your report.

## Rendering (CI does this; useful locally for a preview)

```bash
node .claude/skills/test-report/scripts/render-report.mjs \
  --detect .test-agent/detect.json --report .test-agent/report.json \
  --verification .test-agent/verification.json --out .test-agent/comment.md
```

All agent-authored strings are sanitized before rendering (HTML, links, mentions and table syntax are neutralized), so write plain text — no Markdown, no links.
