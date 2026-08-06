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

- [x] Wire Dockview close events back to chat workspace state.
  - Wired `ChatWorkspace` panel removal events through `ChatShell` to `MainViewApp`.
  - Added a `MainViewApp` close-tab handler that updates workspace state with `closeChatTab`.
  - Added focused source regression coverage for the close-event handoff.

- [x] Render one timeline per Dockview chat panel.
  - Replaced the Dockview placeholder panel body with `MessageTimeline` rendering for each chat tab's channel.
  - Passed timeline data, settings, typing state, user display state, and message callbacks from `ChatShell` into `ChatWorkspace`.
  - Updated workspace panel CSS so timelines fill their Dockview panel.
  - Finding: `MainViewApp` still only exposes the active channel's loaded posts, so inactive tab timelines remain empty until multi-channel history state is added.

- [x] Activate chat workspace tab when clicking or focusing inside its panel.
  - Wired `ChatWorkspace` panel pointer and focus events to the existing active-tab callback.
  - Added source regression coverage for panel-body activation handoff.

- [x] Render a composer inside each Dockview chat panel.
  - Reused the existing `MessageComposer`/`NewMessageComposer` selection in `ChatWorkspace` so every panel has a timeline and composer region.
  - Forwarded existing composer props from `ChatShell` and added minimal panel composer layout CSS.
  - Added focused source regression coverage for the composer handoff.
  - Finding: composer actions still use the legacy active-channel/global reply/edit/draft wiring; Phase 5 is still needed for true per-chat composer state.

- [x] Move reply target into per-chat state.
  - Added `ChatViewStateByChannel` state in `MainViewApp` and updated reply start/cancel handlers through `updateChatViewState`.
  - Derived the active composer reply target from the active channel's chat view state in `ChatShell`.
  - Overrode each Dockview panel composer's reply target and cancel handler from its panel channel state.
  - Added focused source regression coverage for the per-channel reply state handoff.

- [x] Move edit target into per-chat state.
  - Mirrored message-menu edit selection into per-channel `editTargetId` state.
  - Cleared per-channel edit state when canceling, replying, or submitting an edit.
  - Derived active and Dockview panel composer edit targets from each channel's chat view state.
  - Added focused source regression coverage for the per-channel edit state handoff.

- [x] Move drafts into per-chat state.
  - Added controlled draft props to both composer implementations.
  - Stored draft text in `ChatViewStateByChannel` through `MainViewApp`.
  - Derived active and Dockview panel composer draft text from each channel's chat view state.
  - Added focused source regression coverage for the per-channel draft handoff.

- [x] Make composer refs active-tab-aware.
  - Registered each Dockview panel composer handle by channel in `ChatShell`.
  - Routed attach-file, attach-image, and emoji-picker shortcuts through the active chat panel composer with the legacy composer ref as fallback.
  - Added focused source regression coverage for active chat panel composer ref routing.
  - Finding: `bun run typecheck` still fails on the known pre-existing TS2882 CSS side-effect import declaration issue.

- [x] Route Dockview panel composer send and edit-cancel actions through the panel channel.
  - Changed message sending to accept an explicit channel ID instead of using the legacy selected channel.
  - Kept the legacy active composer behavior by wrapping send with the active selected channel in `ChatShell`.
  - Overrode each Dockview panel composer's send and edit-cancel callbacks with its panel channel ID.
  - Added focused source regression coverage for panel-channel send and edit-cancel routing.
  - Finding: `bun run typecheck` still fails on the known pre-existing TS2882 CSS side-effect import declaration issue.

- [x] Ensure switching tabs preserves draft/reply/edit state.
  - Added focused source regression coverage confirming tab activation only changes workspace active tab state while active and panel composers derive draft, reply, and edit state from the current channel.

- [x] Persist open tab metadata.
  - Added serializable persisted chat workspace tab metadata helpers.
  - Restored open tab metadata from saved config when initializing `MainViewApp`.
  - Persisted open tab metadata when channels are opened and tabs are closed without persisting active-tab state yet.
  - Added focused unit and source regression coverage.
  - Finding: `bun run typecheck` still fails on the known pre-existing TS2882 CSS side-effect import declaration issue.

- [x] Persist active tab metadata.
  - Added `activeTabId` to serialized chat workspace tab metadata.
  - Restored the persisted active tab when valid and fell back to the first restored tab when invalid.
  - Persisted active-tab changes from Dockview panel activation.
  - Added focused unit and source regression coverage.

- [x] Change available username colors to the requested palette.
  - Updated `USER_COLOR_PALETTE` to the 32 requested hex colors and bumped `USER_COLOR_PALETTE_VERSION` so stored assignments migrate.
  - Added focused unit coverage for the configured palette.

- [x] Put chat workspace tabs above the channel header.
  - Moved the Dockview chat workspace preview to the first main-panel grid row and the channel header to the second row.
  - Added focused layout regression coverage in `src/mainview/app/ChatShell.test.tsx`.

- [x] Fix channel selection so opening or activating a chat tab selects the matching Dockview panel.
  - Stored the Dockview API in `ChatWorkspace` and activated the panel for `workspace.activeTabId` on readiness and active-tab changes.
  - Added focused source regression coverage in `src/mainview/app/MainViewApp.test.ts`.
  - Validation: `bun test src/mainview/app/ChatShell.test.tsx src/mainview/state/chatWorkspace.test.ts src/mainview/app/MainViewApp.test.ts` passed.
  - Finding: `bun run typecheck` still fails only on the known pre-existing TS2882 CSS side-effect import declaration issue.

- [x] Make Dockview chat workspace tabs match the channel sidebar UI design.
  - Added Dockview tab CSS overrides using the same sidebar background, radius, padding, hover, and active-state tokens.
  - Added focused source regression coverage in `src/mainview/app/ChatShell.test.tsx`.
  - Validation: `bun test src/mainview/app/ChatShell.test.tsx` passed.
