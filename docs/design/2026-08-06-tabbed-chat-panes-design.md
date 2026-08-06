# Tabbed Chat Panes Design

## Summary

Antimatter should support multiple opened channels/chats as draggable tabs arranged into split panes, similar to VS Code or Zed editor groups. Each opened chat needs its own message timeline, message composer, draft state, reply/edit state, and focus behavior. The app also needs a clear notion of the active chat tab/pane so sidebar selection, shortcuts, message actions, and composer focus target the correct chat.

The first planned version should target **in-app panes only**. Native OS-window tear-out should remain future work.

## Scope

### Included

- Multiple opened channels/chats represented as tabs.
- Draggable tab groups with resizable split panes inside the main Antimatter window.
- Each opened chat has its own:
  - Message timeline.
  - Message composer.
  - Draft state.
  - Reply target.
  - Edit target.
  - Scroll position, if feasible.
- A clear active chat tab/pane model.
- Sidebar selection driven by the active chat.
- Sidebar channel clicks that open or activate chat tabs.
- Persisted layout across app restarts.
- Layout restoration that handles missing or inaccessible channels.

### Excluded from first version

- Native OS-window tear-out.
- Floating detached overlays.
- Multiple Mattermost sessions.
- Independent websocket connections per pane.
- Rewriting message storage/fetching beyond what is needed to render multiple chats.
- Adding tab indicators to every sidebar channel unless needed for usability.

### Future extensions

- Native detached windows using ElectroBun/multi-window support.
- Pinned tabs.
- Tab overflow menus.
- Tab search/switcher.
- Open-tab indicators in the sidebar.
- Cross-window drag/drop if native windows are later introduced.

## Current architecture observations

- `MainViewApp.tsx` owns Mattermost session data, API access, websocket updates, channel selection, settings, users, posts, and top-level actions.
- `ChatShell.tsx` currently renders one selected chat surface:
  - Sidebar.
  - Header.
  - `MessageTimeline`.
  - Resizable composer.
  - Global dialogs and menus.
- The current chat surface is centered around:
  - `selectedChannel`.
  - `selectedChannelId`.
  - `posts`.
  - one `composerRef`.
  - one `composerHeight`.
  - global reply/edit targets from `uiStore`.
- `uiStore.ts` currently contains UI state that is partly global and partly chat-specific:
  - `replyTarget` and `editTarget` are chat-specific today but stored globally.
  - `loadingHistory`, `error`, dialogs, notification maps, and websocket status are more global.
- The key architecture change is introducing a workspace/layout layer between `MainViewApp` and per-chat rendering.

## Third-party layout library options

### Option 1: Dockview / `dockview-react`

- Strengths:
  - Built specifically for IDE-like docking layouts.
  - Supports tabs, groups, drag/drop, splitting, floating panels, popout windows, serialization, theming, and custom rendering.
  - React package supports React 16.8 through 19 according to current project research.
  - Zero runtime dependencies in the core library.
  - Its panel/group model maps naturally to opened chats and chat pane groups.

- Concerns:
  - Floating and popout features should be disabled or ignored for the first milestone to keep scope controlled.
  - Styling needs to be adapted to Antimatter’s minimal UI.
  - We should verify SSR/test behavior because current component tests use server rendering in places.

- Fit:
  - Best fit for a VS Code/Zed-style docking model.

### Option 2: `flexlayout-react`

- Strengths:
  - Mature React docking layout manager.
  - Supports draggable tabs, tabsets, splitters, edge docking, maximizing, serialization, custom tab rendering, and TypeScript types.
  - React is its only dependency.
  - Explicitly supports React 18 and 19 according to current docs/search results.
  - Has accessibility features and a configurable keymap.

- Concerns:
  - Model JSON is powerful but heavier than the minimum feature set.
  - Styling and theme integration may require more work.
  - Some features such as borders, popouts, submodels, and renaming should be disabled initially.

- Fit:
  - Strong fallback if Dockview integration is not suitable.

### Option 3: `react-mosaic-component`

- Strengths:
  - React tiling window manager with TypeScript support.
  - Supports split layouts, drag/drop, resizing, controlled state, and JSON persistence.
  - Current v7 documentation describes first-class tab groups and React 16 through 19 support.
  - Smaller conceptual surface than some full docking libraries.

- Concerns:
  - Historically more of a tiling/dashboard library than an IDE-grade editor-group library.
  - NPM signal from search looked weaker than Dockview/FlexLayout.
  - May require more custom work to match VS Code/Zed behavior and polish.

- Fit:
  - Viable, but less compelling than Dockview or FlexLayout for this exact feature.

### Option 4: Build custom with `@dnd-kit`, `react-resizable`, and Radix Tabs

- Strengths:
  - Full control over Antimatter’s UI and behavior.
  - Uses dependencies already present in the project.
  - Could perfectly match the app’s visual style.

- Concerns:
  - High implementation risk.
  - Docking hit-testing, nested split models, tab moves, tab reordering, empty pane cleanup, persistence, keyboard accessibility, and focus management are non-trivial.
  - Easy to spend significant time rebuilding a docking manager.

- Fit:
  - Not recommended for the first implementation.

### Recommendation

Use **Dockview** for the first proof-of-concept, with **FlexLayout** as the fallback if Dockview creates integration, styling, or testability issues.

The feature request is explicitly IDE-like, and Dockview is directly oriented around tabs, docked groups, split panes, serialization, and panel APIs. Its built-in behavior should let Antimatter avoid custom drag/drop docking logic.

## Proposed architecture

### New concepts

#### Chat workspace

The chat workspace owns the tab/pane layout and bridges the docking library to Antimatter channel data.

Responsibilities:

- Track open chat tabs.
- Track active tab and active pane/group.
- Render docked tab groups.
- Add, close, activate, and move tabs.
- Persist and restore layout state.
- Map layout panel IDs to channel IDs.
- Notify `MainViewApp` when the active channel changes.

#### Chat tab

A chat tab represents one opened channel/chat.

Suggested first-version shape:

```ts
export type ChatTabState = {
  id: string;
  channelId: string;
  teamId: string | null;
  title: string;
};
```

For the first version, avoid duplicate tabs for the same channel. Use a stable tab ID derived from the channel ID.

#### Active chat

The active chat replaces the single selected channel as the primary focus concept.

Derived compatibility state can still exist during migration:

```ts
const selectedChannelId = activeChatTab?.channelId ?? null;
```

This allows existing code paths to migrate incrementally instead of rewriting all channel selection logic at once.

#### Per-chat view state

State that currently assumes one active chat should become per-channel or per-tab state.

Per-chat state should include:

- Composer draft.
- Reply target.
- Edit target.
- Composer height, if independent heights are desired per pane.
- Scroll anchor/position, if feasible.

Recommendation for first version:

- Key per-chat state by `channelId` because duplicate tabs for the same channel are excluded initially.
- If duplicate tabs are later supported, migrate state keys to tab IDs or split state into channel-level and tab-level portions.

## Component design

### `MainViewApp`

`MainViewApp` should remain the owner of:

- Mattermost API client.
- Teams, channels, users, posts, unread state, and typing state.
- Websocket updates.
- App settings.
- Message actions such as send, edit, delete, react, vote, load history, and open attachments.

Changes:

- Replace direct single-channel selection as the only chat surface input with chat workspace state.
- Continue deriving `selectedChannelId` from the active chat during migration.
- Sidebar selection should open or activate chat tabs instead of only replacing one selected channel.
- Top-level actions that currently use `selectedChannelId` should either:
  - receive an explicit `channelId` from the active `ChatView`, or
  - use the derived active channel ID for app-level commands.

### `ChatShell`

`ChatShell` should become the app shell around:

- Titlebar.
- Sidebar.
- Global dialogs.
- Global toasts.
- Command menu.
- New `ChatWorkspace`.

It should no longer directly assume the main content contains exactly one `MessageTimeline` and one composer.

### New `ChatWorkspace`

`ChatWorkspace` owns the Dockview/FlexLayout integration.

Responsibilities:

- Initialize docking layout.
- Render one `ChatView` per opened chat tab/panel.
- Open a tab in the active pane/group.
- Activate an existing tab when its channel is selected again.
- Close tabs and choose the next active tab.
- Persist layout changes.
- Restore saved layouts.
- Notify the parent when the active tab changes.

The layout library should be isolated inside this component so most app logic can be tested without depending on DOM-heavy drag/drop behavior.

### New `ChatView`

`ChatView` is the reusable per-chat surface extracted from the current central area of `ChatShell`.

It should render:

- Channel header or the header region assigned to each pane.
- `MessageTimeline` for the tab’s channel.
- Composer for the tab’s channel.
- Reply/edit banners for that tab.
- Per-chat loading-history state if needed.

It should receive explicit props including:

- `channelId`.
- `channel`.
- `posts` for that channel.
- `users`, `userColors`, `userImages`, `userStatuses`.
- `currentUser`.
- `settings`.
- per-chat composer state.
- per-chat reply/edit state.
- callbacks for send, edit, reply, react, load more, typing, attachment open, and context menus.

### Existing `MessageTimeline`

`MessageTimeline` can likely remain mostly unchanged.

Considerations:

- Multiple timelines may be mounted at once.
- The virtualized timeline behavior should be tested when rendered in resizable panes.
- Inactive panes may unmount depending on the docking library, so state that must survive tab switching should live outside `MessageTimeline`.

### Existing composers

Each chat tab needs an independent composer instance.

Required changes:

- Replace the single global `composerRef` with active-tab-aware refs or an imperative registry.
- Move draft/reply/edit state out of global single-chat assumptions.
- Ensure global composer commands target only the active tab:
  - attach file;
  - attach image;
  - open emoji picker;
  - focus composer;
  - send message if any shortcut does that.

## State model

### Workspace layout state

Persist a serializable workspace state:

```ts
export type ChatWorkspaceState = {
  version: 1;
  activeTabId: string | null;
  tabs: Record<string, ChatTabState>;
  layout: unknown;
};
```

The `layout` field should hold the selected library’s serialized layout model, such as Dockview `api.toJSON()` output.

### Per-chat UI state

Suggested first-version shape:

```ts
export type ChatViewState = {
  draftMarkdown: string;
  replyTargetId: string | null;
  editTargetId: string | null;
  scrollAnchorPostId?: string;
  composerHeight?: number;
};
```

Suggested container:

```ts
export type ChatViewStateByChannel = Record<string, ChatViewState>;
```

For reply/edit state, store IDs rather than full post objects where possible. Resolve to the current post object from the posts cache at render time. This avoids stale post references when messages are updated or deleted.

### Global state that should remain global

- App status.
- Connection/websocket status.
- Auth/session config.
- Current user.
- Teams/channels/users/posts caches.
- Unread and typing maps.
- Settings.
- Global dialogs such as settings and create channel/DM.
- Attachment preview dialog.
- Incoming call toasts.

### State that should become per-chat

- Composer draft.
- Reply target.
- Edit target.
- Composer height, if per-pane behavior is desired.
- Timeline scroll position, if preserved across inactive tabs.

## Interaction design

### Opening chats

When the user clicks a channel in the sidebar:

- If the channel already has an open tab, activate that tab.
- If the channel is not open, create a tab in the active pane/group.
- If no pane/group exists, create the first group.
- The active chat becomes the clicked channel.

### Closing tabs

When closing a tab:

- If the closed tab was active, activate the nearest sibling tab if one exists.
- Otherwise activate another tab in the layout.
- If no tabs remain, show an empty chat placeholder.
- Preserve channel-level draft state unless the product decision is to discard drafts on close.

### Dragging tabs

The docking library should provide:

- Reordering tabs within a group.
- Moving tabs between groups.
- Splitting panes by dragging to edges.
- Merging tabs by dropping into the center of another group.
- Resizing panes with splitters.

### Active pane

The active tab/pane should update when:

- The user clicks a tab.
- The user clicks inside a chat view.
- The user opens a channel from the sidebar.
- The layout library emits an active panel change.
- A tab is closed and another tab is selected.

### Sidebar selection

The sidebar should highlight the active chat’s channel.

For first version, avoid adding open-tab indicators unless the UI feels confusing without them.

### Keyboard shortcuts

Existing shortcuts should be routed through the active chat:

- Attach file/image should target the active chat’s composer.
- Emoji picker should target the active chat’s composer.
- Focus composer should focus the active chat’s composer.
- Message actions should use the active chat unless invoked from a specific message row, in which case the channel should be explicit.

Tab navigation shortcuts can be planned later unless required for usability.

## Persistence plan

### Persisted data

Persist:

- Open chat tabs.
- Docking layout model.
- Active tab ID.
- Per-channel draft state if desired.
- Per-channel reply/edit state only if product behavior should restore those after restart.
- Per-channel or per-tab composer height if needed.

### Restore behavior

On startup:

- Load the saved workspace state.
- Validate the saved state version.
- Drop tabs for channels that no longer exist or are inaccessible.
- Drop layout panels that reference removed tabs.
- If the saved active tab is invalid, choose the first valid tab.
- If no valid tabs remain, fall back to the existing last-channel behavior.
- If layout restoration fails, open one tab for the last selected channel.

### Versioning

Use a `version` field so future layout migrations can be handled explicitly.

## Implementation phases

### Phase 1: Library proof-of-concept

Goal: Validate Dockview in Antimatter before committing to the architecture.

Tasks:

- Add Dockview in a small isolated workspace component.
- Render placeholder panels using channel names.
- Validate tab creation.
- Validate tab activation.
- Validate tab closing.
- Validate dragging tabs between groups.
- Validate splitting panes.
- Validate layout serialization and restoration.
- Validate styling feasibility.
- Validate React 19, Bun, and ElectroBun build compatibility.

Exit criteria:

- Core VS Code/Zed-style tab behavior works without custom drag/drop code.
- Layout can be serialized and restored.
- The library can be styled to fit Antimatter.
- The library works with the project’s build/test environment.

### Phase 2: Extract single-chat surface

Goal: Create a reusable `ChatView` without changing current single-chat behavior.

Tasks:

- Extract the current timeline/composer/header body from `ChatShell` into `ChatView`.
- Pass `channelId`, channel data, posts, settings, users, and callbacks explicitly.
- Keep `ChatShell` rendering exactly one `ChatView`.
- Keep existing composer disabled behavior.
- Keep existing tests passing.

Exit criteria:

- Existing single-channel behavior is unchanged.
- `ChatView` can render a chat surface from explicit props.
- No docking library is required for this phase.

### Phase 3: Introduce workspace state

Goal: Support multiple open chat tabs in state, initially with simple rendering.

Tasks:

- Add workspace state for open tabs and active tab.
- Make sidebar selection open or activate a tab.
- Derive `selectedChannelId` from the active tab.
- Render the active chat through the new workspace state.
- Preserve compatibility with existing global actions.

Exit criteria:

- Selecting a channel opens or activates a tab in state.
- Active tab drives sidebar selection.
- Existing behavior still works with one active chat.

### Phase 4: Render chats in docked panes

Goal: Render `ChatView` instances inside Dockview panels.

Tasks:

- Add `ChatWorkspace` using Dockview.
- Map Dockview panel IDs to chat tab IDs.
- Render one `ChatView` per panel.
- Wire active panel changes back to workspace state.
- Wire close events back to workspace state.
- Keep layout state serializable.

Exit criteria:

- Multiple chats can be open at once.
- Each tab renders the correct channel timeline.
- Dragging tabs can split panes and move between groups.
- Active tab controls sidebar selection and global actions.

### Phase 5: Make composer/reply/edit state per chat

Goal: Prevent state leakage between chat tabs.

Tasks:

- Move drafts into per-channel or per-tab state.
- Move reply target into per-chat state.
- Move edit target into per-chat state.
- Make composer refs active-tab-aware.
- Ensure send/edit/reply actions use the correct channel.
- Ensure switching tabs preserves draft/reply/edit state.

Exit criteria:

- Drafts do not leak between tabs.
- Reply/edit state does not leak between tabs.
- Sending from one tab posts to that tab’s channel.
- Shortcuts target the active tab’s composer.

### Phase 6: Persist layout

Goal: Restore open chat tabs and pane layout across restarts.

Tasks:

- Persist workspace layout JSON.
- Persist open tab metadata.
- Persist active tab ID.
- Restore layout on app startup.
- Drop invalid restored tabs.
- Fall back to last-channel behavior when restore has no valid tabs.

Exit criteria:

- Restarting the app restores open chats and pane layout.
- Invalid or inaccessible channels do not break startup.
- Active tab is restored or replaced sensibly.

### Phase 7: Polish and accessibility

Goal: Make the feature feel native to Antimatter.

Tasks:

- Restyle tab chrome and splitters to match Antimatter.
- Add clear active tab/pane visual state.
- Verify focus behavior.
- Verify keyboard shortcut routing.
- Verify screen-reader labels for tab controls where the library allows customization.
- Check resize behavior and layout jank.

Exit criteria:

- The UI feels intentional and consistent with Antimatter.
- Focus behavior is predictable.
- Keyboard shortcuts target the correct chat.
- Pane resizing and tab dragging feel stable.

## Testing strategy

### Unit tests

Test workspace state helpers/reducers separately from the docking library:

- Open a new tab.
- Activate an existing tab.
- Avoid duplicate tabs for the same channel.
- Close inactive tab.
- Close active tab and choose next active tab.
- Remove invalid restored tabs.
- Derive selected channel from active tab.
- Restore with missing active tab.

### Component tests

- `ChatView` renders timeline for the provided channel.
- `ChatView` disables composer when no channel exists.
- `ChatView` sends messages to the provided channel ID.
- Sidebar channel click opens or activates the expected tab.
- Active tab updates sidebar selection.
- Multiple chat views do not share draft/reply/edit state.

### Integration/manual tests

- Open several channels and DMs.
- Drag tabs to split left, right, top, and bottom.
- Drag tabs between pane groups.
- Resize panes.
- Close tabs in different groups.
- Restart app and verify layout restore.
- Send messages from different tabs.
- Reply/edit messages in different tabs.
- Use attach-file, attach-image, and emoji shortcuts with multiple panes.
- Test DMs, self-DMs, archived channels, channels with unread mentions, and channels with attachments.

### Performance checks

- Test with realistic data volumes such as 60+ messages and many open channels.
- Check whether inactive panels unmount in the chosen library.
- If inactive panels unmount, externalize all state that must survive tab switches.
- If inactive panels stay mounted, measure memory/render cost with several timelines open.
- Use React DevTools Profiler on multi-pane layouts.

## Key risks

### Composer state leakage

Current composer, reply, and edit state assumptions are single-chat oriented. These must be deliberately moved to per-chat state.

### Shortcut ambiguity

Global shortcuts must target only the active chat. Shortcuts invoked from a message row should carry explicit channel context where needed.

### Timeline performance

Multiple mounted virtualized timelines may increase memory and render cost. State should be externalized so inactive tabs can safely unmount if the library does that.

### Layout library styling

Docking libraries often include editor-like chrome. Antimatter should restyle tabs and splitters rather than accepting a generic IDE skin.

### Persistence migration

Bad saved layout data should not block startup. Restore should validate and fall back safely.

### SSR/component tests

Docking libraries may depend on DOM measurement. Keep workspace state logic testable separately from the layout library, and use mocks where needed in SSR tests.

## Recommended ticket breakdown

### Ticket 1: Evaluate Dockview with Antimatter

- Add a prototype behind a feature branch or isolated component.
- Confirm build compatibility.
- Confirm styling feasibility.
- Confirm serialization/restore.
- Confirm basic tab behavior.

### Ticket 2: Extract `ChatView` from `ChatShell`

- Preserve existing single-channel behavior.
- Keep current tests passing.
- Do not introduce docking yet.

### Ticket 3: Add chat workspace state

- Track open tabs and active tab.
- Sidebar channel clicks open/activate tabs.
- Keep one active chat rendering path initially.

### Ticket 4: Render tabs in Dockview panes

- Add `ChatWorkspace`.
- Render `ChatView` inside layout panels.
- Wire tab activation and tab close events.

### Ticket 5: Make composer/reply/edit state per chat

- Independent drafts.
- Independent reply/edit targets.
- Active-tab-aware composer refs and shortcuts.

### Ticket 6: Persist and restore workspace layout

- Save tabs, active tab, and layout JSON.
- Restore on startup.
- Validate and drop invalid tabs.

### Ticket 7: Polish active-pane UX and accessibility

- Visual styling.
- Focus handling.
- Keyboard behavior.
- Manual drag/resize testing.

## Open decisions

- Whether the channel header belongs inside each `ChatView` pane or remains as a single shell-level header for the active chat.
- Whether closing a tab should preserve its draft for the channel.
- Whether composer height should be global, per channel, or per pane.
- Whether reply/edit state should survive tab close or app restart.
- Whether inactive chat panels should stay mounted or be allowed to unmount.
- Whether Dockview floating panels should be explicitly disabled in the first version.

## Proposed first milestone

The first production milestone should deliver in-app tab groups and split panes only:

- Dockview-based `ChatWorkspace`.
- One tab per channel.
- Sidebar opens/activates tabs.
- Active tab drives selected channel behavior.
- Each tab has independent composer, draft, reply, and edit state.
- Layout persists across restarts.

Native detached windows should be designed later after the in-app layout model is stable.
