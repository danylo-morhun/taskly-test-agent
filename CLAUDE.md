# Taskly App Node

Full-stack todo app: `backend/` (Node 22, Express 5, Prisma 7 + PostgreSQL, Zod 4) and `frontend/` (React 19, TanStack Query 5, styled-components). Both use Vitest. Each workspace has its own `package.json` and lockfile. There is no root workspace.

## Commands

```bash
cd backend  && npm ci && npm run typecheck && npm test          # tests need no database
cd frontend && npm ci && npm run typecheck && npm run format:check && npm test
node --test '.claude/test-agent/test/*.test.mjs'                 # test-agent tooling
```

## Test agent

- Agent: `.claude/agents/unit-test-agent.md`. Skills: `.claude/skills/*/SKILL.md`. Shared tooling and config: `.claude/test-agent/`.
- PR workflow: `.github/workflows/test-agent.yml`. Design and security model: `SOLUTION.md`.
- Run locally:
  `claude --agent unit-test-agent --settings .claude/test-agent/agent-settings.json "PR mode. Base: origin/main."`
- Workspace layout (sources, tests, coverage exclusions) lives in `.claude/test-agent/config.json`. Update it when adding a workspace or moving tests.

## Conventions

- Backend tests: `backend/tests/<module>.test.ts`, import sources with `.ts` extensions, no real DB (spy Prisma delegates).
- Frontend tests: colocated `*.test.tsx`, mock `design-system` with `design-system/mocks`, Prettier style (no semicolons).
- Commits: Conventional Commits, single line, lowercase.
