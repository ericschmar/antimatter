# Message Timeline Performance Mission

## Goal
Improve native macOS SwiftUI message-timeline performance only. Preserve existing styling, layout, interactions, and user-visible behavior.

## Decision
Exyte Chat's `UIList` is an iOS UIKit `UITableView` adapter, so its data-source, cell-reuse, batch-row-update, rotation, and content-offset mechanics do not apply to Antimatter's macOS SwiftUI `ScrollView`/`LazyVStack` timeline. Its transferable principle is serialized presentation work: avoid concurrently applying stale, expensive list updates.

`MessageTimeline` previously launched a complete detached thread/day projection for every `timeline.posts` publication via `.task(id: timeline.posts)`. This could waste CPU on obsolete full-history projections during pagination or realtime-update bursts.

## Implementation
- Added `LatestOnlyUpdateQueue` in `Sources/AntimatterApp/MessageTimeline.swift`.
- The queue processes one projection at a time, retains one newest pending snapshot, resolves superseded pending submissions with `nil`, and suppresses results that became obsolete while their transform ran.
- The SwiftUI task captures one posts snapshot, honors cancellation before submitting and before applying state, then applies only a current result.
- Existing `ScrollView`, `LazyVStack`, stable item identity, row equality boundaries, styles, and timeline behavior remain intact.
- Added deterministic in-flight-obsolete regression coverage in `NativeTests/AntimatterAppTests/LatestOnlyUpdateQueueTests.swift`.

## Evidence
- Commit: `baa2b45 Coalesce timeline projection updates`
- Focused test: `swift test --package-path . --filter LatestOnlyUpdateQueueTests` — passed.
- Full test suite: `swift test --package-path .` — passed (65 XCTest tests plus 2 Swift Testing tests).
- SwiftPM build: `swift build --package-path .` — passed.
- Xcode Debug app build — passed.
- Xcode Release app build — passed.
- `git diff --check` and `graft check` — passed.
- Independent review found cancellation and race-test gaps; both were fixed before final verification.

## Residual risk / deliberately deferred follow-ups
- This focused change does not change image decoding, Markdown parsing, inline-reply rendering, reaction tooltip preferences, or scroll-anchor behavior. Existing active Beads issues cover the observed resize/inline-reply stalls (`antimatter-5ie`, `antimatter-a6x`, `antimatter-y6w`).
- A manual runtime trace in an image-heavy busy channel remains useful for quantifying the improvement; it is not automatable in the current pure SwiftPM test setup.
