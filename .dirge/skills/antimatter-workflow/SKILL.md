---
description: Project workflow conventions for the Antimatter repository, including Beads issue tracking, TDD expectations, and React component performance rules.
---

# Antimatter Workflow

Use this skill when starting or executing coding work in the Antimatter repository.

## Issue tracking

- Use Beads (`bd`) for project issue tracking.
- Run `bd prime` before substantive issue work to load the current workflow reference.
- Useful commands:
  - `bd ready` to find available work.
  - `bd show <id>` to inspect an issue.
  - `bd update <id> --claim` to claim work.
  - `bd close <id>` to complete work.
- Do not create markdown TODO files for project task tracking.

## Code-change process

- Follow TDD for code changes:
  - Understand the request and acceptance criteria.
  - Explore relevant files before proposing or editing code.
  - Write the smallest failing test that expresses the desired behavior.
  - Run the test and confirm the failure is meaningful.
  - Implement the minimum code required to pass.
  - Rerun the focused test, then relevant lint/type/build checks.
  - Re-read changes for scope creep and unrelated edits.

## React work

- For frequently rendered or list components, use `React.memo`.
- Use `useMemo` for expensive computations and stable object/array props.
- Use `useCallback` for callbacks passed to memoized children.
- Avoid premature broad refactors; apply performance changes only within the requested scope or where directly relevant.

## Known gaps

- Build and test commands are not documented in `CLAUDE.md` yet; infer them from project files when tools are available rather than guessing.