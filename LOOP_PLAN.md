# Loop Plan

- [x] Add chat workspace state helpers for open tabs and active tab.
  - Implemented `src/mainview/state/chatWorkspace.ts` with serializable workspace state, stable channel-derived tab IDs, open/activate/close helpers, invalid restored tab removal, and selected-channel derivation.
  - Added focused unit tests in `src/mainview/state/chatWorkspace.test.ts`.

- [x] Make channel selection open or activate a chat workspace tab.
  - Added local workspace state in `MainViewApp`.
  - Wired `selectChannel` to call `openChatTab` before updating the selected channel.
  - Added a focused source regression test in `src/mainview/app/MainViewApp.test.ts`.

## New findings

- `LOOP_PLAN.md` was not present at the start of this iteration, so this file was created from the selected design task.
- Phase 1's Dockview proof-of-concept requires adding a new dependency; skipped for this iteration to avoid an unapproved dependency change.
