---
name: antimatter-native-selection-overlay-perf
description: Diagnose SwiftUI timeline freezes involving SelectionOverlay, pagination, and per-row visible-content fan-out.
---

# Native SelectionOverlay Performance

Use this for macOS SwiftUI timeline freezes attributed to `Attribute.init`, `SelectionOverlay.updateNSView`, AppKit font/layout work, or upward pagination.

## Diagnosis

- Treat `Attribute.init` as framework bookkeeping when self time is low; follow inclusive descendants.
- `SelectionOverlay` is SwiftUI text-selection infrastructure, not an application or MarkdownUI type.
- Find each `.textSelection(.enabled)` and identify parent state and `.id(...)` modifiers that can recreate all selectable rows.
- For resize symptoms, separate sidebar-state writes from ordinary `HSplitView` width reflow. The removed `channelSidebarWidth` AppStorage writeback was not the reported freeze cause; retain its removal.
- The top `ProgressView` pagination sentinel invokes `loadEarlierPosts()` on appearance. Width/layout changes can reevaluate its visibility, so profile its events with page-load intervals.

## Timeline instrumentation

- `AppLogger.timeline` is an `OSSignposter` at subsystem `com.antimatter.desktop`, category `timeline`.
- Reproduce in a real Mattermost channel using Instruments Points of Interest and Time Profiler together. Compare the problematic channel with a normal channel.
- Correlate sentinel/request/publication events, grouping, author/status/avatar loading, visible attachment/custom-emoji loading, and the main-thread stack.
- Confirm the originating AppKit event: a top `NSSplitView mouseDown:` frame is a divider-resize capture, not a sidebar-scroll capture; the latter needs a `scrollWheel:` frame. Do not restore `WorkspaceShell`'s root `.font(WorkspaceTheme.font(size: 13))`: its inherited UserDefaults-derived font drove `PlatformViewRepresentableAdaptor.updateViewProvider` → `NSControl setFont:` → `NSTextFieldCell` layout invalidation during resize. Keep message font configuration local to timeline rows.
- When application signposts are short but the freeze remains, inspect `SelectionOverlay.updateNSView`, `NSControl.setFont:`, `NSTextField` intrinsic-size/constraint invalidation, MarkdownUI, and AppKit layout stacks. Confirm the originating AppKit event: a Time Profiler top frame of `NSSplitView mouseDown:` is a divider-resize capture, not a sidebar-scroll capture (which should include `scrollWheel:`).
- A root `.font(WorkspaceTheme.font(size: 13))` on `WorkspaceShell` propagated a `UserDefaults`-derived font through the entire workspace. During divider resize it repeatedly drove `PlatformViewRepresentableAdaptor.updateViewProvider` → `NSControl setFont:` → `NSTextFieldCell` intrinsic-size invalidation. Keep message font configuration local to `MessageTimeline`/`MessageRow`/`RichMessageContent` and do not restore that root modifier.
- Do not interpret aggregate Time Profiler inclusive time as a single continuous freeze. A SwiftUI View Properties export only inventories registrations unless it includes an explicit change timeline: stable SelectionOverlay/Markdown registrations do not prove an invalidation loop. If View Body timing is low, body construction is not the cause; record a short Time Profiler capture tightly around the visible stall and inspect the samples at its spike before changing layout code.
- When a stall is too unpredictable for a short capture, sample the live process for the entire hang, then select the stalled range in Time Profiler. A process sample with the main thread repeatedly in `CA::Transaction::flush` → `NSHostingView.layout` → `ViewGraph.updateOutputs` proves active layout churn rather than a deadlock, synchronous IPC, network wait, or I/O. Check for lock/wait frames before drawing that conclusion. If the sampled app is a stripped Release build, framework stack shape can narrow candidates but cannot conclusively identify a SwiftUI view owner; reproduce from a Debug build for application frames before a behavior-changing patch.
- Do not infer ownership from generic runtime layout names alone. In particular, sampled `LazyHStackLayout` frames do not prove the app declares a `LazyHStack`; compare the source hierarchy first. In this app, `MessageTimeline` is the relevant direct `GeometryReader` → `ScrollView` → `LazyVStack` shape, while the sidebar has no outer geometry reader.
- A Debug capture can still have opaque `MessageTimeline` body frames inside generic SwiftUI layout work. A matching `GeometryReaderLayout` → `ScrollViewLayoutComputer` → `_FlexFrameLayout` → `_PaddingLayout` → lazy-layout branch is strong structural attribution, but does not prove `.frame(minHeight:)` alone is defective. Bottom-anchor removal previously failed, so preserve `.frame(minHeight: geometry.size.height, alignment: .bottom)` and `.defaultScrollAnchor(.bottom)`.
- Once disabling `InlineReplyThread` eliminates a resize freeze, use a paired runtime A/B test before changing product layout: keep its divider/container/padding but replace only the inner `LazyVStack → ForEach → InlineReplyRow` subtree with a reply-count label. Ensure the full-thread disable environment variable is off or it bypasses the placeholder entirely.
- A Debug capture can still have opaque `MessageTimeline` body frames inside generic SwiftUI layout work. Treat a matching `GeometryReaderLayout` → `ScrollViewLayoutComputer` → `_FlexFrameLayout` → `_PaddingLayout` → `LazyVStackLayout`/nested `LazyHStackLayout` branch as strong structural attribution to `MessageTimeline`, but not proof that `.frame(minHeight:)` alone is defective. Bottom-anchor removal previously failed, so preserve `.frame(minHeight: geometry.size.height, alignment: .bottom)` and `.defaultScrollAnchor(.bottom)`. Symbolicated `RichMessageContent.body` work at roughly 1 ms and a separate `TimelineViewModel.loadVisibleContent` async task do not explain a main-thread layout stall.

## Inline-reply reaction narrowing

- Use one controlled A/B dimension at a time, retaining bottom anchoring and `.textSelection(.enabled)`. In the validated sequence, removing inline replies eliminated the resize freeze; retaining the thread container with a reply-count label also eliminated it; replacing only `RichMessageContent` with `Text(post.message)` did **not** eliminate it; replacing `ReactionSummary` did. This makes inline-reply reaction rendering the current necessary path, not selectable Markdown or the container itself.
- The validated split isolates `anchorPreference(ReactionTooltipAnchorKey)` as necessary: static emoji/count capsule badges did not freeze; clickable inline Buttons without either anchor preference or hover did not freeze; clickable Buttons with the anchor preference but no hover still froze. The production fix keeps inline reaction Buttons and toggling but omits both the reaction-tooltip anchor preference and per-badge hover callback. Root-message reactions retain tooltips. Remove all diagnostic environment variables and restore ordinary inline Markdown after applying the fix.
- Do not generalize a result from the Markdown-placeholder tree to normal production rendering. Static capsules and clickable Buttons without tooltip infrastructure did not freeze with inline Markdown replaced by `Text`, but normal `RichMessageContent` later froze after anchors/hover were removed; the reduced-tree result was necessary, not sufficient. If that happens, restore normal reaction controls and remove diagnostic gates rather than retaining an unsupported reaction attribution. A bounded mitigation may show the first two replies and provide `Load N more replies` to expand the rest; test both initial and expanded states in the same busy thread.
- For temporary Xcode gates, do not use `#if DEBUG` in this project: its Debug configuration does not define the Swift `DEBUG` condition. Read `ProcessInfo.processInfo.environment` directly, configure each variable in the scheme `LaunchAction`, and instruct the tester to stop the app and relaunch with Cmd-R.
- Before a structural timeline experiment, run paired Debug Time Profiler captures: the same continuous divider drag for 5–10 seconds in a sparse channel without inline replies and in the problematic busy channel. Label exports `sparse` and `busy`, keep window size and drag range comparable, and compare layout cost scaling with grouping/reply complexity.

## Known rendering behavior

- `RichMessageContent` applies `.textSelection(.enabled)` to every Markdown message, including root and inline-reply rows.
- Do not remove text selection: it is a product requirement. Do not patch the internal SelectionOverlay.
- Font-derived identity modifiers in `RichMessageContent` and `MessageTimeline` were removed because they recreated selectable Markdown subtrees; do not reintroduce them without profiling.
- Keep `MessageTimeline` bottom anchoring. Its temporary removal did not fix the freeze.
- Posts publication rebuilds groups through `MessageTimeline`; `MattermostTimelineThreading.threads(from:)` processes the accumulated timeline, so measure regrouping after every page publish.

## Visible-content fan-out

- A real trace found many root/reply rows launching `loadVisibleContent()` on first appearance. They independently loaded the custom-emoji catalog and attachments, causing overlapping long visible-content intervals.
- `WorkspaceShell` owns the single `TimelineViewModel` all rows use. Coalesce at `TimelineViewModel.loadVisibleContent(for:)`: enqueue post IDs, synchronously set an `@MainActor` boolean before the first `await`, then serially drain queued posts. Later callers enqueue and return.
- Do not gate with a stored Task assigned after `Task {}` creation. The task can execute and clear the handle before assignment, reopening the gate and allowing overlapping batches.
- Coalesce the in-flight custom-emoji catalog request. Reprofile afterwards: the original fan-out should collapse to one long interval per batch; cached later calls can still appear as short intervals.

## Verification

```bash
swift build --package-path .
swift test --package-path .
git diff --check
```

Do not apply further broad mitigations until a captured freeze identifies whether pagination, regrouping, content loading, or SwiftUI/AppKit rendering dominates.