# Loop Plan

- [x] Add chat workspace state helpers for open tabs and active tab.
  - Implemented `src/mainview/state/chatWorkspace.ts` with serializable workspace state, stable channel-derived tab IDs, open/activate/close helpers, invalid restored tab removal, and selected-channel derivation.
  - Added focused unit tests in `src/mainview/state/chatWorkspace.test.ts`.

- [x] Make channel selection open or activate a chat workspace tab.
  - Added local workspace state in `MainViewApp`.
  - Wired `selectChannel` to call `openChatTab` before updating the selected channel.
  - Added a focused source regression test in `src/mainview/app/MainViewApp.test.ts`.

- [x] Add per-chat UI state helpers for draft, reply, and edit state.
  - Added `ChatViewState`, `ChatViewStateByChannel`, empty-state creation, and per-channel update helpers in `src/mainview/state/chatWorkspace.ts`.
  - Added focused unit coverage for independent per-channel draft/reply/edit state in `src/mainview/state/chatWorkspace.test.ts`.

- [x] Render the active chat through workspace state while preserving the legacy selected-channel state.
  - Kept the chat workspace state readable in `MainViewApp`.
  - Derived the rendered channel ID from the active workspace tab with the legacy selected channel as fallback.
  - Added focused source regression coverage in `src/mainview/app/MainViewApp.test.ts`.

## New findings

- `LOOP_PLAN.md` was not present at the start of this iteration, so this file was created from the selected design task.
- Phase 1's Dockview proof-of-concept requires adding a new dependency; skipped for this iteration to avoid an unapproved dependency change.
- Dockview dependency has now been added manually by the user, so a future iteration can take the Dockview proof-of-concept task.

- [x] Add Dockview in a small isolated workspace component.
  - Added `src/mainview/components/ChatWorkspace.tsx` as a Dockview-backed placeholder panel renderer using open workspace tabs and channel labels.
  - Wired the proof-of-concept into `ChatShell` via `MainViewApp` without replacing the legacy single-chat body.
  - Imported Dockview CSS and added minimal placeholder workspace styles.

- [x] Synchronize Dockview active panel changes to chat workspace active tab state.
  - Wired `ChatWorkspace` to notify when Dockview's active panel changes.
  - Added a `MainViewApp` active-tab handler that updates workspace state with `activateChatTab`.
  - Added focused source regression coverage and updated `ChatShell` test fixtures.
