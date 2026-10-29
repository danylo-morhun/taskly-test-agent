---
name: test-verification
description: Runs, diagnoses and hardens generated unit tests — targeted runs, failure triage (test bug vs. source bug vs. regression), patch coverage, mutation testing, flakiness and policy checks — until the full verify.mjs self-check passes. Use after writing or changing tests and before reporting results.
license: MIT
compatibility: Node.js >= 22, Vitest, StrykerJS (@stryker-mutator/vitest-runner). Workspaces from .claude/test-agent/config.json.
metadata:
  version: "1.0.0"
---

# Test verification

A test that was never run is not a result. A test that passes but would also pass against broken code is not useful.
Work through the loop below; stop after **5 iterations** and report what is still failing rather than looping forever.

All scripts run tests in a **sanitized environment** (no tokens, `TZ=UTC`) and print compact summaries.

## Tools

| Script (from repo root) | Purpose |
| --- | --- |
| `node .claude/skills/test-verification/scripts/run-tests.mjs --workspace <ws> [--files a,b] [--coverage] [--repeat N --shuffle]` | Run tests; failures with messages |
| `node .claude/skills/test-verification/scripts/patch-coverage.mjs --base <ref> [--workspaces ws]` | Changed executable lines hit by tests (needs a prior `--coverage` run) |
| `node .claude/skills/test-verification/scripts/mutation-test.mjs --workspace <ws> (--base <ref> \| --files a,b)` | Mutation score + undetected mutants on changed lines (or whole files) |
| `node .claude/skills/test-verification/scripts/check-test-policy.mjs` | Only test paths changed, no deleted tests, no `.only/.skip`, no assertion-free files |
| `node .claude/skills/test-verification/scripts/verify.mjs --base <ref> [--mutation]` | Everything above + typecheck + Prettier; **the same check CI runs** |

## The loop

1. **Targeted run** of the test files you wrote: `run-tests.mjs --workspace <ws> --files <tests>`.
2. **Triage each failure** — read the message, then the source again. Decide which case it is:

   | Case | Evidence | Action |
   | --- | --- | --- |
   | Test bug | Wrong import/mock/selector, wrong assumption about existing behavior | Fix the test |
   | Source bug in the PR | Test encodes the documented/obvious intent; the code violates it | **Do not modify source.** Remove that one expectation from the generated tests (proposed tests must pass) and record it in `concerns` with file, line and the failing input |
   | Regression | A **pre-existing** test fails because of the PR's source change | **Do not modify that test.** Record it in `regressions`. Only if the PR explicitly states the behavior change is intended (PR description, commit message, or an updated spec/test by the author) update the test and mark the decision `updated_tests`, citing the evidence |
   | Environment | Missing generated client, crash before tests run | Report; do not work around by editing config |

   Never make a test pass by weakening it: no deleting assertions, no `.skip`, no broad `expect.anything()` where a value is known, no mocking the unit under test.
3. **Full suite with coverage** for each affected workspace: `run-tests.mjs --workspace <ws> --coverage` — new tests must not break others.
4. **Patch coverage**: `patch-coverage.mjs --base <ref>`. For every uncovered changed line, either add a test or decide it is not worth covering (defensive branch, logging) and say so in the decision reason.
5. **Mutation testing** on changed lines: `mutation-test.mjs --workspace <ws> --base <ref>`. For each undetected mutant on meaningful logic (conditions, boundaries, returned values, arguments to collaborators), add or sharpen an assertion. Equivalent mutants (e.g. changed log text, no observable effect) may be left — mention them in `selfCheck.notes`. Target ≥ 80 % on changed lines; do not chase 100 % with brittle tests.
6. **Final self-check**: `verify.mjs --base <ref> --mutation`. It must print `Verification PASSED`. Record the result and iteration count in the report's `selfCheck`.

## Flakiness

`verify.mjs` re-runs changed test files 3× with shuffled order. Typical causes and fixes: shared mutable fixtures (clone per test), leaking mocks (`vi.restoreAllMocks()`/`vi.clearAllMocks()` in hooks), real timers or `Date.now()` (fake timers), unawaited promises (`await` / `findBy…`), order-dependent module state (`vi.resetModules()`).
