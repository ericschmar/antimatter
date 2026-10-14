## M1: Make the native message timeline significantly more performant without changing its UI | status: completed
### T1.1: Research Exyte Chat and adapt only its applicable update-queue principles | status: completed
- [x] S1.1.1: Review Exyte ChatView/UIList and distinguish UIKit-specific table mechanics from transferable serialized-update behavior.

### T1.2: Eliminate overlapping, stale full-timeline projections | status: completed
- [x] S1.2.1: Add a native SwiftUI latest-only queue for thread/day timeline projection snapshots.
- [x] S1.2.2: Ensure cancelled SwiftUI tasks and obsolete in-flight projections cannot commit stale items.

### T1.3: Test, review, and validate the focused performance change | status: completed
- [x] S1.3.1: Add a deterministic regression test for an in-flight obsolete projection.
- [x] S1.3.2: Run focused and full SwiftPM tests, SwiftPM build, Xcode Debug/Release builds, diff checks, and an independent implementation review.
- [x] S1.3.3: Commit the verified implementation.
