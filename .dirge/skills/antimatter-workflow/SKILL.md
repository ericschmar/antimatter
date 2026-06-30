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

## MDXEditor/Lexical notes

- `MDXEditorMethods.focus({ defaultSelection: "rootEnd" })` only uses the default selection when no Lexical selection exists; it does not force an existing caret to the end.
- For editor-selection bugs after programmatic content changes, capture the root Lexical editor with `createRootEditorSubscription$` and force selection in `editor.update(...)`, for example `$getRoot().selectEnd()`.
- Lexical `EditorFocusOptions` does not support `preventScroll`; that option is available on MDXEditor's focus wrapper, not the underlying Lexical editor.

## Known gaps

- `CLAUDE.md` may lag behind the actual scripts; confirm commands from `package.json` if they change.