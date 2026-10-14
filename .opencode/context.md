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

## Active: native table row-height correction (uncommitted)
- User reported content clipping for complex Markdown, images, links, attachments, and inline replies after the AppKit timeline migration.
- Root cause investigation showed `NSHostingView` with intrinsic-size sizing reports a one-line/fitting height even when constrained to the timeline column. A direct XCTest shows `NSHostingController.sizeThatFits(in:)` returns the correct wrapped height at the same width.
- Current uncommitted changes are deliberately limited to `Sources/AntimatterApp/TimelineTableView.swift` and `NativeTests/AntimatterAppTests/TableSnapshotUpdatePlanTests.swift`; do not touch unrelated `.opencode/**` or `AGENTS.md` churn.
- The bridge now uses reusable `NSHostingController`-backed cells; rows are measured at the actual table-column width, cached by stable ID, invalidated on rendered geometry changes, and cleared/re-measured when the viewport width changes. `NSTableView` uses cached measured heights and retains `44pt` as its offscreen estimate.
- User then reported `Invalid view geometry` diagnostics with infinity/too-large coordinates. Root cause: current measurement passed `CGFloat.greatestFiniteMagnitude` as `sizeThatFits` height; rich SwiftUI media/geometry can propagate this unbounded proposal.
- The pending fix replaces it with `TimelineRowHeightPlan.maximumMeasurementHeight = 10_000`, rejects non-finite/invalid input or returned sizes, and falls back to the finite estimate. A `ponytail:measurement-ceiling` comment documents the practical single-message ceiling and upgrade path.

## Latest verification / next move
- Latest focused command: `swift test --package-path . --filter TableSnapshotUpdatePlanTests && swift build --package-path . && git diff --check` — passed; 14 focused XCTest cases.
- Prior comprehensive verification before the latest finite-bound guard: full SwiftPM suite (76 XCTest + 2 Swift Testing), SwiftPM build, Xcode Debug and Release builds, `graft check`, and diff check passed. Re-run full/Xcode verification after current change if proceeding to commit.
- Next action: manually run the Debug app against the reported rich-content messages. Confirm both (1) no invalid geometry diagnostics and (2) no clipped content after initial render or async media/link expansion. Then review and commit only the two intended files if confirmed.

## Latest runtime feedback (still uncommitted)
- Finite proposal eliminated invalid-geometry diagnostics and images look correct, but replies/link previews initially consumed the full 10,000pt proposal.
- A targeted XCTest demonstrated that vertically flexible SwiftUI roots consume a positive `sizeThatFits` height proposal. The current uncommitted cell wraps the root in `.fixedSize(horizontal: false, vertical: true)`, which made replies/link previews stop using 10,000pt. Focused verification now has 15 passing tests plus a SwiftPM build and diff check.
- New user feedback: after the `.fixedSize` correction, reply/message-row top and bottom are clipping again. Next investigation must trace the actual cell measurement versus its final Auto Layout/table frame and geometry-change feedback; do not assume the fixed-size root’s `sizeThatFits` result is what the table ultimately lays out.
