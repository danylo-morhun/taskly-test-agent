---
name: test-impact-analysis
description: Analyzes a code change (PR diff or explicit target files) and decides, per changed source file, whether unit tests must be added, updated or are not needed, and where they belong. Use at the start of any test-generation task, before writing a single test.
license: MIT
compatibility: Requires git and Node.js >= 22. Workspace layout comes from .claude/test-agent/config.json.
metadata:
  version: "1.0.0"
---

# Test impact analysis

Goal: a short, justified **test plan** — one decision per changed source file — before any test is written.
Writing tests for the wrong things wastes the budget; skipping risky logic defeats the purpose.

## 1. Get the deterministic change list

If the task input already contains a `detect.json` path, read it. Otherwise run:

```bash
node .claude/skills/test-impact-analysis/scripts/detect-changes.mjs --base <base-ref> [--head <head-ref>]
```

Without `--head` it compares `base` to the working tree's `HEAD`. The output classifies every changed file:

| Field | Meaning |
| --- | --- |
| `sources` | Testable production files (with `changedLines`). **Only these get decisions.** |
| `tests` | Test files the PR itself changed — read them, they show the author's intent. |
| `excluded` | Production code the project deliberately excludes from coverage (types, barrels, design system, entry points). Never write tests for these. |
| `other` | Config, docs, styles, lockfiles. Ignore. |
| `deletedSources` | Removed modules — check for now-stale tests and mention them in the report. |
| `omitted` | Files over the per-run budget — list them as `skipped` with reason "over per-run budget". |

**Target-files mode** (coverage improvement, no PR): when the task names files instead of a base ref, treat each whole file as changed and skip step 1.

## 2. Understand each change

For every file in `sources`:

1. `git diff <base>...HEAD -- <file>` — what exactly changed (new function, new branch, changed condition, refactor).
2. Read the **whole** file — tests need the full contract, not just the hunk.
3. Find existing tests:
   - backend: `backend/tests/<module>.test.ts` (flat directory, named after the module: `router.ts` → `router.test.ts`)
   - frontend: colocated `<Name>.test.ts(x)` next to the source file
   - also `grep -rl "<module-name>" backend/tests frontend/src --include='*.test.*'` for indirect coverage
4. Read callers when the change alters a contract (signature, return shape, error behavior).

## 3. Decide

| Situation | Decision |
| --- | --- |
| New exported function, component, hook, endpoint, or new branch / condition / error path | `added_tests` (or `updated_tests` if a test file for the module already exists — **extend it**, do not create a parallel file) |
| Behavior of existing code changed intentionally | `updated_tests` — adjust the affected expectations and add cases for the new behavior |
| Behavior changed and an existing test now fails, but nothing shows the change is intended | **Regression**: do not touch that test; report it (see `test-verification` skill) |
| Pure refactor/rename with unchanged behavior, already covered (verify with patch coverage later) | `no_tests_needed` — say which existing tests cover it |
| Type-only change, constant/copy text tweak, logging, re-export, styling, wiring without logic | `no_tests_needed` — state the reason concretely |
| Process bootstrap with no logic of its own (e.g. a 3-line `main.ts`) | `no_tests_needed`, unless it contains branching or error handling |

Heuristics:

- **Risk first.** Validation, error handling, branching, data mapping, cache updates and boundary values matter more than rendering static text.
- One behavior per test case; name tests after observable behavior, not implementation.
- Prefer the narrowest seam the codebase already uses (see the workspace skill): mocking the collaborator one level down, not the module under test.
- If a change cannot be unit-tested without modifying production code (hidden global state, no seam), choose `skipped`, explain why and suggest the refactor in `concerns`.

## 4. Write the plan down

Before writing tests, record the plan (TodoWrite or a short note), e.g.:

```text
backend/src/features/todos/router.ts   → updated_tests  backend/tests/router.test.ts  (+GET/PATCH/DELETE /:id: 404, 422, success)
frontend/src/lib/http.ts               → added_tests    frontend/src/lib/http.test.ts (network error, 422 copy, detail passthrough, 204)
frontend/src/features/todos/types.ts   → (excluded: types only)
```

Then load the workspace skill for each affected workspace (`backend-unit-tests`, `frontend-unit-tests`) and implement.
