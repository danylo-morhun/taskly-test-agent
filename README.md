# taskly-test-agent

Claude Code agent that writes unit tests for pull requests, with a GitHub Actions workflow
that runs it. it is built on Taskly, a small todo app with an Express backend
and a React frontend.

on every pull request the agent decides which changed files need tests, writes or updates them,
checks them with coverage and mutation testing, and opens a separate pull request with the tests
into the feature branch. it never changes production code. a report is posted as one comment
on the original pull request.

the full write-up with design decisions, the security model and example runs is in
[SOLUTION.md](SOLUTION.md).

## agent and skills

| file                                | what it is                                                              |
| :---------------------------------- | :---------------------------------------------------------------------- |
| `.claude/agents/unit-test-agent.md` | the agent: role, order of skills, rules, output format                  |
| `test-impact-analysis`              | decides per changed file whether it needs tests                         |
| `backend-unit-tests`                | how to write backend tests, with reference patterns                     |
| `frontend-unit-tests`               | how to write frontend tests, with reference patterns                    |
| `test-verification`                 | runs tests, typecheck, patch coverage and mutation testing              |
| `test-report`                       | writes the final report and validates it against a JSON schema          |
| `.claude/hooks/`                    | block writes outside test files and shell commands outside an allowlist |
| `.claude/test-agent/`               | config, shared scripts and their own `node:test` tests                  |

## workflow

`.github/workflows/test-agent.yml` runs in five jobs.

| job      | what it does                                                                                               |
| :------- | :--------------------------------------------------------------------------------------------------------- |
| context  | finds the pull request. skips forks, drafts, the `test-agent:skip` label and the agent's own pull requests |
| detect   | classifies changed files without an LLM. with nothing to test, the agent is not called                     |
| generate | runs the agent. this is the only job with the LLM key, and its GitHub token is read-only                   |
| verify   | checks the agent's patch again from scratch, with no secrets and with tooling from the base branch         |
| publish  | pushes the tests and updates the report comment, without running code from the pull request                |

closing a pull request closes its test pull request and deletes the branch.

## setup

the workflow needs a repository secret `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
for the test pull requests, add a GitHub App with read and write access to contents
and pull requests, then set the variable `TEST_AGENT_APP_CLIENT_ID` and the secret
`TEST_AGENT_APP_PRIVATE_KEY`. the variable `TEST_AGENT_MODEL` changes the model.

the agent has to be on the default branch, because pull requests are checked
with the base branch's version of it. it can also be run by hand:

```bash
gh workflow run test-agent.yml -f pr=<number>
```

## Taskly

the app is a todo list.

| part     | stack                                                     |
| :------- | :-------------------------------------------------------- |
| backend  | Node.js, Express 5, Prisma 7, Zod, Postgres, Vitest       |
| frontend | React 19, TanStack Query, styled-components, Vite, Vitest |

```bash
cp .env.example .env
docker compose up --build -d --wait
```

the app runs at `http://localhost:8080`, the API docs at `http://localhost:8000/docs`.

## run the agent locally

```bash
(cd backend && npm ci) && (cd frontend && npm ci)
claude --agent unit-test-agent --settings .claude/test-agent/agent-settings.json "PR mode. Base: origin/main."
node .claude/skills/test-verification/scripts/verify.mjs --base origin/main --mutation
npm run test:agent-tooling
```

the `verify.mjs` call runs the same checks as CI.
