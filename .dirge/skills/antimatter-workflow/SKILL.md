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

## Adding an app setting

Settings flow: settings window (`src/childview`) → bun (`src/bun`) → main-view state (`src/mainview/app/ChatShell.tsx`) → component props. The RPC + bun handlers pass the whole `AppSettingsPayload` generically, so a new boolean setting rides along once it exists on the type — but several spots must be updated together or `bun run typecheck` fails with cascading errors:

- **Type defs (parallel, keep in sync):** add the field to `AppSettings` (`src/mainview/types.ts`) AND to `AppSettingsPayload` (`src/shared/electrobunRpc.ts`).
- **Object literals (all three):** `defaultSettings` (`src/mainview/storage.ts`), bun's `latestSettings` (`src/bun/index.ts`), and every full-literal in `src/mainview/storage.test.ts` round-trip tests.
- **Normalizer:** add a boolean branch in `normalizeSettings` (`src/mainview/storage.ts`) mirroring the existing `notificationSounds` pattern: `typeof value.<field> === "boolean" ? value.<field> : defaultSettings.<field>`.
- **Settings window UI:** add the control in `src/childview/index.html` (checkbox uses `<label class="inline-setting">`), then in `src/childview/index.ts` add the element lookup, push it into the input-listener array, set `.checked` in `renderSettings`, and read `.checked` in `readSettings`.
- **Prop thread:** pass the setting from `ChatShell` into `MessageTimeline`, destructure it, thread it down to the row component, and add it to any `memo` comparator (`prevProps.<field> === nextProps.<field>`) so toggling re-renders memoized rows. Skipping the comparator entry is a silent bug — the row won't update when the setting flips.

TDD sequence that works here: write the failing storage test first (default + a disabled round-trip), confirm red, then land the type defs + literals + normalizer, confirm green.

## Verification commands

- Use Bun for project scripts and tests.
- Focused component test example: `bun test src/mainview/components/MessageComposer.test.ts`.
- Standard verification after code changes:
  - `bun run typecheck`
  - `bun test`
  - `bun run build`

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