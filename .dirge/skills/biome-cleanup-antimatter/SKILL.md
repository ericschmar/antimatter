---
name: biome-cleanup-antimatter
description: Workflow for cleaning Biome diagnostics in the Antimatter repository without fighting generated outputs or TypeScript index-signature settings.
---

# Biome cleanup in Antimatter

Use this skill when asked to fix Biome errors or warnings in this repository.

## Correct command

- Run modern Biome explicitly with `bunx @biomejs/biome check .`.
- Do not use `bunx biome`; it resolves the obsolete `biome` package (`0.3.x`) and can report a false clean run.

## Config expectations

- Generated/tool output should be excluded from Biome scans:
  - `build`
  - `artifacts`
  - `.dirge`
  - `.beads`
  - `.claude`
- This repo uses TypeScript `noPropertyAccessFromIndexSignature`, so keep Biome `complexity/useLiteralKeys` disabled. Applying that rule’s unsafe fixes creates TS4111 errors for index-signature-backed maps.
- Existing CSS selector ordering intentionally relies on cascade structure, so `style/noDescendingSpecificity` may be disabled rather than reordering unrelated UI CSS.
- Existing editor/backdrop drag/click containers may need `a11y/noStaticElementInteractions` and `a11y/useKeyWithClickEvents` disabled rather than converting wrappers to `<button>`; nested interactive content inside a button is invalid HTML.
- Filename sanitizers may intentionally include control-character ranges; either split the regex into Unicode escapes or disable `suspicious/noControlCharactersInRegex` if the sanitizer is intentional.

## Verification

- `bunx @biomejs/biome check . --max-diagnostics=200` should pass. If it reports only a schema-version info for `biome.json` (for example schema 2.5.3 with CLI 2.5.8), treat that as informational unless the task is to update Biome config.
- `bun test` should pass.
- `bun run build` should pass.
- `bun run typecheck` should pass. CSS side-effect imports are covered by `src/css.d.ts` with `declare module "*.css";`; if TS2882 CSS import errors return, check that this declaration file is present and included by `tsconfig.json`.
