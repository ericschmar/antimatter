---
name: antimatter-virtualized-react-ssr-tests
description: Deterministic testing pattern for Antimatter React components that use @tanstack/react-virtual while existing tests render with react-dom/server.
---

# Antimatter virtualized React SSR tests

Use this when migrating a component to `@tanstack/react-virtual` and existing Bun tests assert `renderToString` output.

## Pattern

- Keep the component using real `useVirtualizer` in production code.
- In the affected `*.test.tsx`, mock `@tanstack/react-virtual` with Bun's `mock.module` before importing the component under test.
- Return a hook-compatible object that renders all items deterministically:
  - `getTotalSize()` sums `estimateSize(index)` for all items.
  - `getVirtualItems()` returns one item per index with `index`, `key: getItemKey(index)`, and cumulative `start` offsets.
  - Include no-op `measure`, `measureElement`, and `scrollToIndex` methods.
- Type `reduce<number>(...)` accumulators explicitly, because TypeScript can infer `unknown` in this setup.
- Add a focused assertion for the virtual wrapper class plus existing message content so SSR still exercises row rendering.

## Example mock shape

```ts
mock.module("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize, getItemKey }) => ({
    getTotalSize: () =>
      Array.from({ length: count }).reduce<number>(
        (total, _, index) => total + estimateSize(index),
        0,
      ),
    getVirtualItems: () =>
      Array.from({ length: count }).map((_, index) => ({
        index,
        key: getItemKey(index),
        start: Array.from({ length: index }).reduce<number>(
          (total, _unused, previousIndex) => total + estimateSize(previousIndex),
          0,
        ),
      })),
    measure: () => {},
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));
```

## Verification

```bash
bun test src/mainview/components/MessageTimeline.test.tsx
```
