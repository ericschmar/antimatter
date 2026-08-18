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
  - `bd close <id>` to complete work. Stage/commit `.dirge/skills/**` edits before the session-close `git pull --rebase` — an unstaged skill patch makes the rebase fail while `git push` still succeeds, leaving stray uncommitted files.- Do not create markdown TODO files for project task tracking.
- Beads IDs look like `antimatter-4q5`; the built-in issue/todo board tool uses separate `drg-*` IDs — `bd update drg-...` fails with "no issue found". Find Beads IDs via `bd list --json` (or `bd list | grep <term>`). `bd create <title> --type feature --priority 2 --description <desc> --acceptance <criteria>` works (`--priority` accepts both `P1`-style and bare numbers); there is no `--tag` flag.

## Code-change process

- Follow TDD for code changes:
  - Understand the request and acceptance criteria.
  - Explore relevant files before proposing or editing code.
  - Write the smallest failing test that expresses the desired behavior.
  - Run the test and confirm the failure is meaningful.
  - Implement the minimum code required to pass.
  - Rerun the focused test, then relevant lint/type/build checks — run gates bare (no trailing pipe) and read the real exit code.
  - Re-read changes for scope creep and unrelated edits.

## Channel selection semantics (rendered channel / sidebar unread)

- The channel actually visible is the **rendered channel**: `getRenderedChannelId(workspace, standaloneChannelId)` (src/mainview/state/chatWorkspace.ts) returns the active workspace tab's channel, else the standalone selection. In `MainViewApp`, `standaloneChannelId` is null while any workspace tab is active.
- `selectedChannelRef.current` mirrors ONLY the standalone selection and goes stale once a chat workspace tab renders. Any "is this channel visible" check — unread badges in `handlePost` (`useMainViewEvents.ts`), `refreshAfterReconnect`'s `changedChannels` filter — must use `getRenderedChannelId(chatWorkspaceStore.workspace, selectedChannelRef.current)`, never `selectedChannelRef` alone.
- Sidebar unread badges live in `uiStore.channelNotifications`; `uiActions.clearChannelNotification(channelId)` clears one. It is called from `selectChannel`, `openChatPanel`, and `handleActivateChatTab` (tab focus) so a channel that becomes visible never keeps a stale unread flag.

## SSR component tests that import the electrobun rpc module

A component that transitively imports `src/mainview/app/rpc` cannot be statically imported in a `react-dom/server` (`renderToString`) test: electrobun's view API reads `window.__electrobunWebviewId` at module init, so a static import fails with `ReferenceError: window is not defined`. Declare the mock before any component import and load the component with a top-level dynamic import (see `src/mainview/components/AuthScreen.test.tsx` and `src/mainview/app/ChatShell.test.tsx`):

```ts
mock.module("../app/rpc", () => ({ electrobun: { rpc: null } }));
const { AuthScreen } = await import("./AuthScreen");
```

Mock `../storage` the same way when the rendered tree reads or writes persisted state.

## Source-slice test convention

When the expected snippet contains double quotes, wrap the expectation string in single quotes instead of escaping the inner quotes — `biome check` fails on the escaped double-quoted form and rewrites it (e.g. the `defaultConfigSource={envConfig ? "env" : "saved"}` expectation in `MainViewApp.test.ts`). Run `bunx @biomejs/biome check --write` on the test file after pasting snippets, and scope biome to the changed files: a tree-wide `biome check src/mainview` reports pre-existing failures in untouched files (e.g. `state/chatWorkspace.ts` formatting, `utils/perfTrace.ts` noUnreachable).

`MainViewApp.test.ts` and `src/mainview/features/events/useMainViewEvents.test.ts` assert exact code snippets read from the source file (`readFileSync` + `expect(body).toContain("...")`, function bodies sliced between `indexOf` markers) rather than runtime behavior. When adding or repairing such tests: run `bunx @biomejs/biome check --write` on the source file FIRST, then copy the post-format snippet into the expectation — Biome reflows call shapes (e.g. collapses multi-line `mutateSWR(...)` into one line plus options object) and breaks string matches if formatting happens after the test is written.

Refactoring guarded source breaks existing expectations by design: grep the matching `*.test.ts` for the identifier you changed and update the snippet to the new source (e.g. replacing `const renderedChannelId = activeWorkspaceChannelId ?? selectedChannelId;` with a `getRenderedChannelId(...)` call broke one `MainViewApp.test.ts` guard until its expectation was rewritten).

## Verification notes

- For MUI X Chat greenfield timeline work, verify reviewer-sensitive gaps explicitly: `Conversation.Root` is rendered inside `Chat.Root`; timeline context/public props include both object and id forms (`channel`, `channelId`, `currentUser`, `currentUserId`); `ChatMessage.metadata` explicitly carries Mattermost `post`, `replies`, `files`, `reactions`, `poll`, `deleted`, `pending`, and `failed`; top-level user/profile behavior uses `UserDetailsTrigger` and wires `onStartDm` and `onSetUserColor`; nested replies preserve `onShowMessageContextMenu`.
- The greenfield MUI X Chat headless timeline is under `src/mainview/components/mui-headless-timeline/`: `muiChatModels.ts` maps Mattermost models to MUI chat models, `MuiMessageTimeline.tsx` renders the headless timeline, and `MuiMessageTimeline.css` owns timeline-specific styling. `ChatShell.tsx` and split-panel `ChatWorkspace.tsx` mount it while the original `MessageTimeline`/`MessageRow` are now FROZEN references — the MUI headless timeline is the canonical chat target (branch `replace-timeline-mui-chat`).

## Rendering-smoothness + selective Valtio migration

The approved plan is at `docs/design/2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md`. Approach: "jank first, Valtio as a lever" — establish a Phase 0 performance baseline, apply Phase 1 cheap rendering fixes, then migrate state to Valtio (Phase 2) only where profiling proves re-render scope is the cause. Phases: 0 baseline → 1 cheap fixes → 2 selective Valtio → 3 optional workspace store → 4 docs/ADR.

**Perf instrumentation (`src/mainview/utils/perfTrace.ts`, Phase 0, landed):** guarded no-op in production, enabled at runtime via `localStorage.setItem('mm-clone:perf','1')` + window reload; off by default. Output is `console.debug` with a `[perf]` prefix (filterable in DevTools). `traceSync(label, fn)` times synchronous work; `markRender(name)` buffers per-component render counts auto-flushed every ~1.5s from `MuiMessageTimelineInner`. Test-only hooks are `__`-prefixed (`__setPerfEnabled`, `__resetPerfCache`, `__flushPerfRenderCounts`). Wired into `buildMuiTimelineMessages` (timing) and `MarkdownRenderer` + `MattermostTextPart` + `MuiMessageItem` (render counts). Intended to stay in-tree through Phase 2 so each phase re-measures with the identical yardstick; the design doc's Appendix has a capture runbook with blank fields to record the baseline.

**Valtio store convention for new shared state:** extend the existing footprint (`state/uiStore.ts` → `uiStore` proxy + `uiActions`; `features/channels/useChannelPreferences.ts`) rather than add another library. Module-level `proxy` plus a `*Actions` object that owns ALL writes; components read via `useSnapshot`. Never read the proxy outside `useSnapshot` in render; never mutate during render. The Phase 2 plan is to move `posts`/`users`/`userImages`/`userStatuses`/`userColors` (currently large `useState` pools in `app/MainViewApp.tsx`, with `users`/`images`/`statuses` actually held in `features/users/useUserPresence.ts`) into a new `state/dataStore.ts` proxy following this pattern, then have each `MuiMessageItem` read only its own slice so an unrelated field change doesn't re-render it.

**Known jank hot paths flagged in the design (verify against the baseline before fixing):** (1) `MarkdownMessage.tsx`/`MessageMarkdown.tsx` re-parse markdown (ReactMarkdown/remarkGfm and @uiw) on every visible-row render — only the mention transform is memoized, the parse is not cached by content; (2) `MuiTimelineContext` rebuilds its provider value object every render, so all `useMuiTimelineContext()` consumers re-render regardless of `memo`; (3) `MuiMessageTimeline.tsx` does a double `scrollToBottom` (sync + RAF) plus `setLoadMoreReadyChannelId` on every channel load; (4) static `estimatedItemSize={112}`.
- The focused MUI timeline regression command is `bun test src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx`. It should cover the conversation wrapper, metadata, top-level meta order, markdown/mentions, floating typing indicator, nested replies, deletions, attachments, reactions, reach-top loading, and polls.
- When styling the MUI headless timeline, override MUI/light defaults with Antimatter theme tokens (`--app-bg`, `--panel-*`, `--text-*`, `--app-font-*`). Keep message content and MUI bubbles transparent so row hover/highlight color shows through. Avoid `!important`; Biome flags `lint/complexity/noImportantStyles`, so use scoped selector specificity instead.
- For MUI headless timeline regressions, the fast focused verification is `bun test src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx`. Follow CSS-only timeline styling changes with `bunx @biomejs/biome check src/mainview/components/mui-headless-timeline/MuiMessageTimeline.css`; run full `bun test` when behavior crosses component boundaries.
- MUI timeline CSS is imported through `src/mainview/index.css`, not by importing legacy `MessageTimeline.css`. Scope timeline-specific overrides under `.mui-message-timeline`; if shared markup such as `.reaction-pill` appears inside the MUI timeline, restate the base pill box model there before styling variants like `.reaction-pill.mine`.
- For MUI X Chat headless timeline initial-load scroll issues, use a `ref` on `MessageList.Root` typed as `MessageListRootHandle` and call `scrollToBottom({ behavior: "auto" })` when the channel changes or channel content first loads. Repeat the call in `requestAnimationFrame` so it runs after row measurement/rendering, and avoid firing it for history prepends where scroll position should be preserved.
- Markdown mention styling is centralized in `MarkdownMessage.tsx`/`MessageMarkdown.tsx`: `highlightMentionsInMarkdown` wraps `@username`, `@channel`, and `@here`, and the custom `MentionStrong` renderer emits `mention`, `mention-highlight`, and `mention-here` classes. Keep the ReactMarkdown and `@uiw` markdown paths wired to the same renderer.
- For MUI timeline reaction highlights, let `.reaction-pill.mine` inherit the base `.reaction-pill` border radius; only adjust selected-state border color/box-shadow so current-user reactions do not get a mismatched shape.
- Mattermost markdown mention handling is centralized in `src/mainview/components/MarkdownMessage.tsx`: `highlightMentionsInMarkdown` preprocesses mentions and `MentionStrong` assigns mention classes. If the @uiw markdown path is active, wire the same strong renderer in `MessageMarkdown.tsx` so legacy and new markdown renderers stay visually consistent.
- For MUI headless timeline legacy styling parity: `MessageMarkdown.tsx` and `MarkdownMessage.tsx` share mention preprocessing/rendering; MUI timeline CSS scopes mention/reaction/typing styles under `.mui-message-timeline`; `ReactionPill` already emits `.reaction-pill.mine`; typing users come from `MuiTimelineContext.typingUsers` and should render with the legacy `.typing-indicator`/`.typing-dots` structure.
- Agent-local `.dirge/` skill/session/memory files can appear in the working tree during tool use. Unless the user explicitly asked to change project skills, remove unrequested `.dirge/` changes before handoff after confirming only `.dirge` paths are affected.
- Unstaged `.dirge/` edits also break the session-close `git pull --rebase` ("cannot pull with rebase: You have unstaged changes") while `git push` itself still succeeds, leaving the tree unverified-clean. Commit or stash `.dirge/` edits before the closing pull/push.
- Run `bun install --frozen-lockfile` before `bun run typecheck` if dependencies are absent; otherwise Volta may report that it cannot locate `tsc`.
- With TypeScript 7, use `--ignoreConfig` for focused file checks that pass file names directly. For TSX files, include `--jsx react-jsx`; if the files import CSS side effects, include `--noUncheckedSideEffectImports false`, for example `./node_modules/.bin/tsc --ignoreConfig --noEmit --jsx react-jsx --target ESNext --module ESNext --moduleResolution bundler --lib ESNext,DOM --strict --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noUncheckedSideEffectImports false <files>`.
- `bun run typecheck` now passes cleanly project-wide (the former TS2882 CSS side-effect import errors are gone); treat any new `error TS` as real rather than pre-existing.
- Notification/toast work (routing errors, adding toast variants, ChatShell SSR tests) is covered by the `antimatter-toast-notifications` skill — load it before touching error display in ChatShell.
- Full-suite gate is bare `bun test` (fast, ~1s, 273+ tests); run it before any commit, not just the focused files. Focused files first for the TDD red→green loop, then the full gate.
- Empty-chat behavior (user-chosen scope): the `.chat-empty` "Select a conversation" screen in `ChatShell` appears ONLY after the user closes the last workspace chat tab — `handleCloseChatTab` then runs `setSelectedChannelId(null)` (capturing `closedTab` before `closeChatTab`, since the record is gone afterwards). App launch still restores the last conversation from persisted `lastChannelId`; do not "fix" launch to start empty. Covered by `ChatShell.test.tsx` "renders an empty select-a-conversation screen when no channel is selected" and the exact-source `handleCloseChatTab` snippet in `MainViewApp.test.ts`.

## WebRTC implementation guide workflow

When working from `WEBRTC_IMPLEMENTATION_GUIDE.md`:

- Read the relevant guide phase or section before editing, not the whole long file by default; use the markdown outline/headings to target the needed section.
- Treat guide snippets and paths as a plan to validate, not code to copy blindly. Map each step to existing project files and conventions first.
- Keep work phase-scoped: Foundation, WebRTC Core, UI Components, Integration, or Polish/Testing. Do not continue into the next phase unless asked.
- Preserve the guide’s core requirements when in scope: ICE candidate buffering/batching, `replaceTrack()` device switching, remote stream assembly, `BroadcastChannel` multi-tab coordination, session recovery, sender/session validation, ICE restart, and cleanup of listeners/media resources.
- Treat Mattermost signaling payloads as untrusted boundary data and validate sender/session fields.
- For UI phases, follow the React memoization rules in this skill and avoid redesigning unrelated UI.
- Verify with the fastest available typecheck/build/lint/test command after inspecting project config, because `CLAUDE.md` does not document authoritative commands.
- Report guide deviations, blockers, manual WebRTC checks, and unverified areas explicitly.

## React work

- For frequently rendered or list components, use `React.memo`.
- Use `useMemo` for expensive computations and stable object/array props.
- Use `useCallback` for callbacks passed to memoized children.
- When a memo comparator receives nested arrays of rendered data, include every nested field that can affect visible output. For `MessageTimeline` replies, changes to reply text, attachments, and reactions must invalidate the row, not just reply `id`/`update_at`.
- Avoid premature broad refactors; apply performance changes only within the requested scope or where directly relevant.
- Be careful with app-startup effects and persisted config: `selectChannel` writes `lastChannelId` via `setConfig`, so effects that connect on startup must not rerun just because channel navigation persisted config. A stale async reconnect can replay an old selected channel and cause oscillation.

## UI conventions (Radix + lucide)

- Icons: import PascalCase components from `lucide-react` (e.g. `Bold`, `Italic`, `Strikethrough`, `Code`/`Code2`, `Heading`, `Quote`, `List`, `ListOrdered`, `Link`, `Paperclip`, `Send`, `SmilePlus`, `Sticker`, `CaseSensitive`, `Eye`/`EyeOff`). Render with `<Icon size={n} />`. All of these exist in the pinned `lucide-react ^1.16.0`.
- Icon button + tooltip (canonical pattern; see `Sidebar.tsx`, `ChatShell.tsx`): wrap the app once in `<Tooltip.Provider>` near the root, then per button:
  ```tsx
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button aria-label="…" className="…" type="button" onClick={…}>
        <Icon size={14} />
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content className="tooltip-content" side="right" sideOffset={6}>
        Label
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
  ```
  The `.tooltip-content` style already lives in `src/mainview/index.css` — reuse it rather than adding new tooltip CSS.
- Other Radix primitives in use: `@radix-ui/react-dropdown-menu` (popovers/menus via `* as DropdownMenu`), `react-scroll-area`, `react-tabs`, `react-dialog`, `react-slot`, plus `@radix-ui/colors`. They follow the same `asChild` + `Portal` shape.
- In Bun `react-dom/server` component tests, Radix `DropdownMenu.Content` does not render into the SSR HTML even with `Root defaultOpen` and `Portal`/`Content forceMount`. Do not use `renderToString` HTML assertions for dropdown menu contents; prefer a DOM-capable interaction test when available, or a narrow source/CSS regression test if the repo still lacks a DOM harness.
- Scoping CSS for the new (`@uiw`-based) composer vs. the old (MDX) one: target `.composer-new` / `.composer.composer-new` selectors so the MDX `MessageComposer` styles in `MessageComposer.css` stay untouched.
- Attachment preview uses `@iamjariwala/react-doc-viewer`; keep app-specific overrides scoped under `.attachment-preview-body` in `src/mainview/index.css`. To remove react-doc-viewer's extra top bar, set `config.header.disableHeader: true`; `disableFileName` alone only hides the filename. For PNG/image previews, override `.rdv-image-container` and `.rdv-png-checkerboard` backgrounds because the library defaults to a white image container plus checkerboard background image.

## Mattermost DM/sidebar behavior

- Direct-message creation in the main view is centralized as `onCreateDm(userIds: string[])`. For user-specific entry points like message-author dropdowns or command-menu user results, thread a stable callback (`useCallback`) down to the component and call `onCreateDm([userId])` rather than adding a separate API path.
- `MattermostApiClient.getChannelsForUserTeam` must include DMs outside the selected team. Load all pages of `/users/{userId}/teams/{teamId}/channels`, load all pages of `/users/{userId}/channels`, then merge only user-wide direct/group channels (`type === "D" || type === "G"`) into the selected-team channels and de-duplicate by channel id.
- Locally archived channels are hidden from sidebar sections. When a channel is opened directly or from search, call `unarchiveChannel(channel.id)` before loading/selecting it so an active archived DM reappears in the DM list.
- `CommandMenu` can reach channels that are not currently visible in the sidebar via remote channel/post/user search. If search can open a DM that the sidebar cannot show, check archived-channel filtering before assuming the channel-fetch API missed it.

## Testing notes for React/Radix

- Component tests commonly use `react-dom/server` `renderToString`, but Radix `DropdownMenu.Portal` content may not appear in SSR output even with `defaultOpen`/`forceMount`. For dropdown-item regressions, use a source-level assertion or a real DOM interaction test rather than expecting the menu item in SSR HTML.

## Adding an app setting

Settings flow: settings window (`src/childview`) → bun (`src/bun`) → main-view state (`src/mainview/app/ChatShell.tsx`) → component props. The RPC + bun handlers pass the whole `AppSettingsPayload` generically, so a new boolean setting rides along once it exists on the type — but several spots must be updated together or `bun run typecheck` fails with cascading errors:

- **Type defs (parallel, keep in sync):** add the field to `AppSettings` (`src/mainview/types.ts`) AND to `AppSettingsPayload` (`src/shared/electrobunRpc.ts`).
- **Object literals (all three):** `defaultSettings` (`src/mainview/storage.ts`), bun's `latestSettings` (`src/bun/index.ts`), and every full-literal in `src/mainview/storage.test.ts` round-trip tests.
- **Normalizer:** add a boolean branch in `normalizeSettings` (`src/mainview/storage.ts`) mirroring the existing `notificationSounds` pattern: `typeof value.<field> === "boolean" ? value.<field> : defaultSettings.<field>`.
- **Settings window UI:** add the control in `src/childview/index.html` (checkbox uses `<label class="inline-setting">`), then in `src/childview/index.ts` add the element lookup, push it into the input-listener array, set `.checked` in `renderSettings`, and read `.checked` in `readSettings`.
- **Prop thread:** pass the setting from `ChatShell` into `MessageTimeline`, destructure it, thread it down to the row component, and add it to any `memo` comparator (`prevProps.<field> === nextProps.<field>`) so toggling re-renders memoized rows. Skipping the comparator entry is a silent bug — the row won't update when the setting flips.

TDD sequence that works here: write the failing storage test first (default + a disabled round-trip), confirm red, then land the type defs + literals + normalizer, confirm green.

## Timeline markdown renderer toggle

- `settings.useNewComposer` now gates both the composer and message timeline markdown renderer. Pass it from `ChatShell` into `MessageTimeline`, then into `MessageRow` and reply rows.
- Timeline renderer split: flag off uses `MarkdownMessage` (`react-markdown`); flag on uses `@uiw/react-md-editor/nohighlight` via `MDEditor.Markdown` plus `@uiw/react-markdown-preview/markdown.css` and a scoped `.markdown-message-new` class.
- Preserve existing Mattermost behavior when using `MDEditor.Markdown`: reuse/export `highlightMentionsInMarkdown` from `MarkdownMessage`, and use the same image resolution/load helpers (`useResolvedImageSrc`, `useImageLoadInfo`) for inline markdown images.
- `MessageRow` is memoized with a custom comparator. Any renderer-affecting prop such as `useNewComposer` must be included in the comparator, or toggling the setting will not re-render existing rows.
- Component tests can use `react-dom/server` `renderToString` for this renderer toggle. Assert the legacy path lacks `.markdown-message-new`, and the new path contains both `.markdown-message-new` and @uiw's `.wmde-markdown` output.
- When server-rendering `ChatShell` tests, mock `./rpc` before dynamically importing `ChatShell` so ElectroBun browser APIs do not touch `window`, and mock `../storage` helpers that read `localStorage`. Capture mocked composer props when testing prop derivation such as disabled state instead of exporting one-off helper functions solely for tests.

## Message composer architecture & editor transforms

- Two composer components, switched in `src/mainview/app/ChatShell.tsx` on `settings.useNewComposer`: `MessageComposer.tsx` (MDXEditor/Lexical, the default) and `NewMessageComposer.tsx` (@uiw/react-md-editor, behind the flag). Both share the `MessageComposerHandle`/`MessageComposerProps` types (defined in MessageComposer.tsx) and `MessageComposer.css`. New-composer-only overrides live in `NewMessageComposer.css` — scope every new rule under `.composer.composer-new` so the two composers never collide.
- **Editor transforms live in their own zero-heavy-import module** so their unit tests don't pull the editor runtime into the test graph (the lexical TDZ rule below). `mentions.ts` (mention match/insert) and `markdownActions.ts` (`wrapSelection` / `toggleLinePrefix` / `insertLink`, each taking `message + { start, end }` selection and returning `{ message, selection }`) follow this pattern; both the component and its `.test.ts` import from there.
- `@uiw/react-md-editor` still installs default keyboard shortcuts when `hideToolbar` is set. If Antimatter owns the toolbar/shortcuts, pass stable typed empty arrays to both `commands` and `extraCommands`; leaving them undefined enables defaults such as `Cmd/Ctrl+Q` quote insertion, which can steal macOS app quit.
- Applying a transform from the component: read the textarea's `selectionStart/End`, call the helper, `setMessage(result.message)`, then in a `requestAnimationFrame` call `textarea.focus()` + `textarea.setSelectionRange(result.selection.start, result.selection.end)` to restore caret. Share one `recomputeHeight` call (the `handleMessageChange` auto-resize) so programmatic edits resize the editor too.
- `@uiw/react-md-editor` installs shortcuts from `commands` and `extraCommands` even when `hideToolbar` is set. If Antimatter supplies its own toolbar/shortcuts, pass stable empty `ICommand[]` arrays to both props; otherwise default shortcuts like `Cmd/Ctrl+Q` quote insertion can intercept native app/menu shortcuts.
- **lucide-react icon check:** before importing an icon name, confirm it exists — the pinned `^1.16.0` ships fewer aliases than current releases. `node -e "const l=require('./node_modules/lucide-react/dist/cjs/lucide-react.js'); ['Bold','Italic','Strikethrough','Code','Code2','Link','Heading','Quote','List','ListOrdered','Eye','EyeOff','CaseSensitive'].forEach(n=>console.log(n, typeof l[n]))"`.
- **Color tokens:** green/accent greens come from `@radix-ui/colors/grass-dark.css` (imported in index.css, with local overrides). `--grass-9` (#278747, overridden) backs the `--accent-*` aliases; `--grass-11` (#71d083, lighter) reads well for an outlined green affordance. Outline a `border:0` toggle with `box-shadow: inset 0 0 0 1px <color>` rather than flipping `border`, to avoid a 1px layout shift.

## Mattermost channel labels

- Direct-message channel labels are formatted in `src/mainview/utils/format.ts`. Mattermost self-DMs can have a raw direct channel name shaped `userId__userId`; `directChannelOtherUserId(channel, currentUserId)` should return the current user id in that case so `channelLabel` resolves the display name instead of showing the raw channel name.
- Add formatter regressions in an adjacent `src/mainview/utils/*.test.ts` file using Bun's `import { describe, expect, test } from "bun:test"` style.

## Verification commands

- For Bun/server-rendered app component tests that import `ChatShell`, mock `./rpc` before dynamic import to avoid ElectroBun browser API (`window`) access. If rendering touches app-update banner state, mock `../storage` helpers too so tests don't require `localStorage`.
- Use Bun for project scripts and tests.
- For Biome, run `bunx @biomejs/biome check .` or `bunx @biomejs/biome check . --max-diagnostics=200`; avoid `bunx biome`, which resolves the obsolete `biome` 0.3.x package and can falsely report clean output.
- Keep Biome `complexity/useLiteralKeys` disabled while TypeScript `noPropertyAccessFromIndexSignature` is enabled; applying that unsafe fix creates TS4111 errors on index-signature-backed objects.
- Focused component test example: `bun test src/mainview/components/MessageComposer.test.ts`.
- Standard verification after code changes:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
- `bun run typecheck` (tsc --noEmit) is the source of truth for type errors. Inline LSP diagnostics surfaced by the edit/write tools can be stale or pre-existing and may not reflect the working tree (e.g. phantom `useNewComposer`/`AppSettingsPayload` errors that persist even though the types are in sync) — only chase type errors the standalone tsc run also reports.
- If `bun run typecheck` fails with TS2882 side-effect CSS import declaration errors for side-effect CSS imports (`react-resizable/css/styles.css`, component CSS files, `@mdxeditor/editor/style.css`, `@uiw` CSS, etc.), treat it as the current pre-existing declaration/config blocker unless new diagnostics point at the changed feature code. Report the blocker accurately rather than expanding scope.

## Building & inspecting packaged builds

- `bun run build` (alias `electrobun build`) defaults to **env=dev** and produces `build/dev-macos-arm64/Antimatter-dev.app` — a DEV build that does NOT bundle JS into the .app (it runs from source). Use `bun run build:release` (`--env=stable` → `build/stable-macos-arm64/Antimatter.app`) or `bun run build:canary` (`--env=canary` → `build/canary-macos-arm64/Antimatter-canary.app`) to produce a real packaged bundle.
- Stable/canary bundles ship JS inside `Contents/Resources/<hash>.tar.zst`. To verify source changes are actually in the bundle: `tar --use-compress-program=unzstd -xf <file>` then grep the extracted `app/bun/index.js` / `app/views/mainview/index.js`.
- A stale `.tar.zst` dated before your source means you built the wrong env; `bun run build` (dev) does NOT refresh a stable/canary dir. `rm -rf build/<env>-macos-arm64` and rebuild with the matching `--env`.

## Reading runtime logs from a packaged build

- A GUI app launched from Finder routes stdout/stderr to `/dev/null`, so bun-process `console.log` is invisible by default.
- To see bun logs (`[WS]`, `[RPC]`, `[Notification]`): run the launcher from a terminal so stdout is attached — `<bundle>/Contents/MacOS/launcher 2>&1 | tee ~/Desktop/antimatter-bun.log`, then `grep -E '\[WS\]|\[RPC\]|\[Notification\]'`. App Nap still engages (it is keyed on window occlusion, not launch method), so terminal-launching is safe for reproducing backgrounded behavior.
- Renderer (WKWebView) logs (`[Renderer]`, `[Notification] Requesting from renderer`) do NOT reach the terminal — they are only visible in DEV mode via Safari → Develop menu → machine → the Antimatter webview → Console; release/packaged builds suppress the JS console, so correlate renderer timestamps by reproducing in `bun run dev`.
- `log stream` / Console.app are unreliable for raw `console.log` (ElectroBun does not bridge to os_log); prefer the terminal-launch method.

## MDXEditor/Lexical notes

- `MDXEditorMethods.focus({ defaultSelection: "rootEnd" })` only uses the default selection when no Lexical selection exists; it does not force an existing caret to the end.
- For editor-selection bugs after programmatic content changes, capture the root Lexical editor with `createRootEditorSubscription$` and force selection in `editor.update(...)`, for example `$getRoot().selectEnd()`.
- Lexical `EditorFocusOptions` does not support `preventScroll`; that option is available on MDXEditor's focus wrapper, not the underlying Lexical editor.
- `@lexical/utils` 0.35.x's `LexicalUtils.node.mjs` re-exports every symbol via top-level `await import(...)` (`export const $splitNode = mod.$splitNode`). Under newer Bun this circular-export form throws `ReferenceError: Cannot access '$splitNode' before initialization` (TDZ), surfacing in `bun:test` as "Unhandled error between tests" any time a test transitively loads MDXEditor → lexical. **Prevention rule:** do NOT co-locate pure, independently-unit-tested helpers inside a `.tsx` that imports a heavy framework — extracting them pulls the whole runtime into the test module graph. Keep pure helpers in their own import-light module (e.g. the mention helpers now live in `src/mainview/components/mentions.ts`) and have both the test and the component import from there.

## Known gaps

- The test suite is pure-logic only — no DOM test harness (no @testing-library, jsdom, or happy-dom in `package.json`; tests are `*.test.ts` using `bun:test` that assert exported functions, not rendered components). So the TDD "write a failing test" step is not possible for runtime/DOM behavior such as scroll position, focus, or visibility. For those changes, implement the fix, run `bun run typecheck` / `bun test` / `bun run build` to confirm no regressions, and verify the actual behavior manually in the running ElectroBun app.
- The main view runs in a WKWebView (via ElectroBun) that defers layout for non-visible windows, so scroll/geometry taken on return-to-app is stale. Scroll-pinned UI (e.g. `MessageTimeline`) needs a `visibilitychange` + window `focus` effect to re-assert position, not just `useLayoutEffect` + `ResizeObserver`.
- `CLAUDE.md` may lag behind the actual scripts; confirm commands from `package.json` if they change.
- CI (`.github/workflows/ci.yml`) runs on `macos-latest` with `oven-sh/setup-bun@v2` and **no `bun-version` pin**, so CI resolves the latest Bun while local dev may be older. A bug that doesn't reproduce locally can still fail CI (the lexical TDZ crash above is the canonical example). When a CI-only test failure looks like a runtime/module-init error, suspect the Bun-version gap before chasing the test logic.