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
- When a memo comparator receives nested arrays of rendered data, include every nested field that can affect visible output. For `MessageTimeline` replies, changes to reply text, attachments, and reactions must invalidate the row, not just reply `id`/`update_at`.
- Avoid premature broad refactors; apply performance changes only within the requested scope or where directly relevant.

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
- Scoping CSS for the new (`@uiw`-based) composer vs. the old (MDX) one: target `.composer-new` / `.composer.composer-new` selectors so the MDX `MessageComposer` styles in `MessageComposer.css` stay untouched.

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

## Message composer architecture & editor transforms

- Two composer components, switched in `src/mainview/app/ChatShell.tsx` on `settings.useNewComposer`: `MessageComposer.tsx` (MDXEditor/Lexical, the default) and `NewMessageComposer.tsx` (@uiw/react-md-editor, behind the flag). Both share the `MessageComposerHandle`/`MessageComposerProps` types (defined in MessageComposer.tsx) and `MessageComposer.css`. New-composer-only overrides live in `NewMessageComposer.css` — scope every new rule under `.composer.composer-new` so the two composers never collide.
- **Editor transforms live in their own zero-heavy-import module** so their unit tests don't pull the editor runtime into the test graph (the lexical TDZ rule below). `mentions.ts` (mention match/insert) and `markdownActions.ts` (`wrapSelection` / `toggleLinePrefix` / `insertLink`, each taking `message + { start, end }` selection and returning `{ message, selection }`) follow this pattern; both the component and its `.test.ts` import from there.
- Applying a transform from the component: read the textarea's `selectionStart/End`, call the helper, `setMessage(result.message)`, then in a `requestAnimationFrame` call `textarea.focus()` + `textarea.setSelectionRange(result.selection.start, result.selection.end)` to restore caret. Share one `recomputeHeight` call (the `handleMessageChange` auto-resize) so programmatic edits resize the editor too.
- **lucide-react icon check:** before importing an icon name, confirm it exists — the pinned `^1.16.0` ships fewer aliases than current releases. `node -e "const l=require('./node_modules/lucide-react/dist/cjs/lucide-react.js'); ['Bold','Italic','Strikethrough','Code','Code2','Link','Heading','Quote','List','ListOrdered','Eye','EyeOff','CaseSensitive'].forEach(n=>console.log(n, typeof l[n]))"`.
- **Color tokens:** green/accent greens come from `@radix-ui/colors/grass-dark.css` (imported in index.css, with local overrides). `--grass-9` (#278747, overridden) backs the `--accent-*` aliases; `--grass-11` (#71d083, lighter) reads well for an outlined green affordance. Outline a `border:0` toggle with `box-shadow: inset 0 0 0 1px <color>` rather than flipping `border`, to avoid a 1px layout shift.

## Verification commands

- Use Bun for project scripts and tests.
- Focused component test example: `bun test src/mainview/components/MessageComposer.test.ts`.
- Standard verification after code changes:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`
- `bun run typecheck` (tsc --noEmit) is the source of truth for type errors. Inline LSP diagnostics surfaced by the edit/write tools can be stale or pre-existing and may not reflect the working tree (e.g. phantom `useNewComposer`/`AppSettingsPayload` errors that persist even though the types are in sync) — only chase type errors the standalone tsc run also reports.
- If `bun run typecheck` fails with TS2882 side-effect CSS import declaration errors during a CSS-only change, treat it as a pre-existing declaration/config blocker unless the change touched TS imports. Verify the intended CSS delta with `git diff -- <css files>` and report the blocker accurately rather than expanding scope.

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