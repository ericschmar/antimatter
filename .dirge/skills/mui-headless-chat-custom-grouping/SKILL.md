---
description: Preserve MUI X Chat headless message grouping behavior when Antimatter renders custom message rows instead of the default MessageGroup children.
---

# MUI headless chat custom grouping

Use this when Antimatter renders custom children inside `@mui/x-chat/headless` `MessageGroup` and grouped messages still show repeated author/avatar/time/status metadata.

## Root cause

`MessageGroup` calculates grouping internally from adjacent list items and the provided `groupKey`, but custom row markup outside MUI's default `Message.Root`/`Message.Meta` composition will still render whatever metadata Antimatter puts in its own JSX. The group wrapper can add `is-grouped` classes and can clone direct `Message.Root` children with `isGrouped`, but it does not automatically suppress custom author/time/status markup.

## Fix pattern

- Use the same grouping function passed to `MessageGroup`, usually `createTimeWindowGroupKey(5 * 60_000)`.
- For each rendered item, look up the immediately previous message by `messageIds[index - 1]`.
- Treat the item as grouped when `groupKey(previousMessage) === groupKey(message)`.
- Hide the repeated author/avatar/time/status only for grouped continuation rows.
- Keep a layout spacer in the left meta column if the row CSS uses a fixed two-column grid. Removing the meta element entirely can shift message content into the meta column.

## Verification

- Add a render test with two same-author messages inside the grouping window.
- Assert the first row has visible meta, the grouped row has the grouped/spacer class, and the author trigger/time are not duplicated.
- Run the focused Bun test and Biome on the changed files:

```bash
bun test src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx
bunx @biomejs/biome check src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx
```
