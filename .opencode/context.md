# Message Timeline Performance Mission

## Goal
Improve native macOS SwiftUI message-timeline performance only. Preserve existing styling, layout, interactions, and user-visible behavior.

## Expanded scope
Manual testing showed that coalescing projections alone did not eliminate layout hangs. The user explicitly approved replacing the SwiftUI `ScrollView`/`LazyVStack` layout engine with the native macOS equivalent of Exyte's `UITableView`: an `NSTableView` using reusable SwiftUI-hosting cells. Beads issue `antimatter-ann` tracks this second phase.

The implementation must retain the existing SwiftUI message/date/inline-reply views as cell content, serialize incremental snapshots, preserve the visible row when earlier history is prepended, preserve focused/latest-message scrolling and bottom alignment, and make no intentional visual changes.

## Decision
Exyte Chat's `UIList` is an iOS UIKit `UITableView` adapter, so its data-source, cell-reuse, batch-row-update, rotation, and content-offset mechanics do not apply to Antimatter's macOS SwiftUI `ScrollView`/`LazyVStack` timeline. Its transferable principle is serialized presentation work: avoid concurrently applying stale, expensive list updates.

`MessageTimeline` previously launched a complete detached thread/day projection for every `timeline.posts` publication via `.task(id: timeline.posts)`. This could waste CPU on obsolete full-history projections during pagination or realtime-update bursts.

## Implementation
- Added `LatestOnlyUpdateQueue` in `Sources/AntimatterApp/MessageTimeline.swift`.
- The queue processes one projection at a time, retains one newest pending snapshot, resolves superseded pending submissions with `nil`, and suppresses results that became obsolete while their transform ran.
- The SwiftUI task captures one posts snapshot, honors cancellation before submitting and before applying state, then applies only a current result.
- Existing `ScrollView`, `LazyVStack`, stable item identity, row equality boundaries, styles, and timeline behavior remain intact.
- Added deterministic in-flight-obsolete regression coverage in `NativeTests/AntimatterAppTests/LatestOnlyUpdateQueueTests.swift`.
- Added `TimelineTableView`, a view-based one-column `NSTableView` bridge with reusable `NSHostingView` cells, automatic variable row heights, stable row identities, bounded visible-cell reconfiguration, incremental insert/remove snapshots, and reload fallback for retained-row reordering.
- Preserved pagination position using the first retained visible message row plus its intra-row pixel offset. The pagination sentinel is excluded so prepends move it offscreen instead of draining pages.
- Preserved short-list bottom alignment, latest/root/reply focus scrolling, reaction tooltip placement across hosting roots, width-dependent height invalidation, existing SwiftUI row content, and explicit `UserColorSettings` environment propagation.
- Added pure incremental snapshot regression tests in `NativeTests/AntimatterAppTests/TableSnapshotUpdatePlanTests.swift` and added the new bridge to the Xcode app target.

## Evidence
- Commit: `baa2b45 Coalesce timeline projection updates`
- Focused test: `swift test --package-path . --filter LatestOnlyUpdateQueueTests` — passed.
- Full test suite: `swift test --package-path .` — passed (65 XCTest tests plus 2 Swift Testing tests).
- SwiftPM build: `swift build --package-path .` — passed.
- Xcode Debug app build — passed.
- Xcode Release app build — passed.
- `git diff --check` and `graft check` — passed.
- Independent review found cancellation and race-test gaps; both were fixed before final verification.
- AppKit phase focused tests passed (8 snapshot/anchor tests and 7 direct-message hosting tests).
- Full SwiftPM suite passed (73 XCTest tests plus 2 Swift Testing tests).
- SwiftPM build and Xcode Debug/Release app builds passed.
- AppKit review identified state-remount, pagination-anchor, column-width, tooltip-anchor, same-day prepend, collapsed focused-reply, and superseded-scroll races; each was addressed before the final re-review.

## Mission synchronization
- No unresolved mission synchronization issues. The local implementation and verification commits are `baa2b45`, `ec62a4c`, `7c8cc1a`, and `838e412`.
- Beads issue `antimatter-ann` is closed with all acceptance criteria verified.
- The optional Beads Dolt remote is intentionally unconfigured in this embedded/solo checkout; `bd dolt push` explicitly reports that local issue storage is sufficient.

## Residual risk / deliberately deferred follow-ups
- This change intentionally leaves image decoding, Markdown parsing, and inline-reply content rendering untouched. Existing active Beads issues cover remaining content-level costs (`antimatter-5ie`, `antimatter-a6x`, `antimatter-y6w`).
- A manual runtime trace in an image-heavy busy channel remains useful for quantifying the improvement; it is not automatable in the current pure SwiftPM test setup.
