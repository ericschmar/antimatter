# Loop Plan

- [x] Add chat workspace state helpers for open tabs and active tab.
  - Implemented `src/mainview/state/chatWorkspace.ts` with serializable workspace state, stable channel-derived tab IDs, open/activate/close helpers, invalid restored tab removal, and selected-channel derivation.
  - Added focused unit tests in `src/mainview/state/chatWorkspace.test.ts`.

## New findings

- `LOOP_PLAN.md` was not present at the start of this iteration, so this file was created from the selected design task.
- Phase 1's Dockview proof-of-concept requires adding a new dependency; skipped for this iteration to avoid an unapproved dependency change.
