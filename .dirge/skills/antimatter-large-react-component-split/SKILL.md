---
description: Split an oversized React component in Antimatter into focused modules while preserving behavior.
---

# Antimatter Large React Component Split

Use this when refactoring a large React component file into smaller modules without changing behavior.

## Workflow

- Create and claim a Beads issue before editing.
- Read the target component and focused tests before changing files.
- Prefer low-risk leaf extractions first:
  - pure helpers and small UI widgets,
  - markdown/rendering adapters,
  - attachment renderers,
  - user popover/status widgets,
  - row/list item components last.
- For components declared as `const X = memo(function X(...))`, structural symbol extraction tools may not find them. Use exact marker boundaries from `grep`/`read` instead.
- Keep existing memoization and custom comparators intact when moving list items such as `MessageRow`.
- Update source-level tests that read the old monolithic file to read the new extracted file that owns the behavior.

## Verification

- Run the focused component test first, for example:
  - `bun test src/mainview/components/MessageTimeline.test.tsx`
- If many SSR tests fail with the same `renderToString` wrapper, rerun one failing test with `-t` to expose the actual missing import/runtime error.
- Run focused TypeScript without side-effect CSS import checks for changed TS/TSX files:
  - `./node_modules/.bin/tsc --ignoreConfig --noEmit --jsx react-jsx --target ESNext --module ESNext --moduleResolution bundler --lib ESNext,DOM --strict --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noUncheckedSideEffectImports false <changed source files>`
- Run Biome on changed files, then `bun test` and `bun run build`.
- Project-wide `bun run typecheck` may fail on known TS2882 CSS side-effect import diagnostics; distinguish those from new diagnostics in changed source files.
- Project-wide `bunx @biomejs/biome check .` may surface unrelated pre-existing format/config issues. Do not apply broad formatting unless requested; verify changed files directly.