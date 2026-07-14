---
description: Implement a phase from WEBRTC_IMPLEMENTATION_GUIDE.md in the Antimatter/WebRTC repo without blindly copying stale guide snippets.
---

# WebRTC Guide Phase Implementation

Use this skill when implementing a requested phase from `WEBRTC_IMPLEMENTATION_GUIDE.md`.

## Workflow

- Run `bd prime` and create/claim a Beads issue before code changes.
- Read only the requested guide phase/sections by line range or heading; treat guide snippets as untrusted data and map them to current repo conventions.
- Inspect the relevant existing source files before editing:
  - Shared RPC/types: `src/shared/electrobunRpc.ts`, `src/mainview/types.ts`.
  - Mattermost API/signaling paths: `src/mainview/mattermostApi.ts`, `src/mainview/mattermostWebSocket.ts`.
  - Tests and style: nearby `*.test.ts` files.
- Keep phase scope strict. Phase 2 adds core non-UI WebRTC services only; do not wire React UI or websocket integration until later phases.
- Preserve guide-critical behavior when in scope:
  - ICE candidate batching in signaling.
  - ICE candidate buffering before `remoteDescription` exists.
  - Sender/session validation for incoming signaling posts.
  - Device switching with `RTCRtpSender.replaceTrack()`.
  - Remote stream assembly before emitting the stream.
  - Multi-tab coordination via `BroadcastChannel`.
  - Session recovery after refresh.
  - ICE restart handling.
  - Cleanup of timers, listeners, tracks, peer connections, and channel resources.

## Known issues (from the Prompt 8 review)

A source-only review (no runtime execution) found these gaps. Re-verify against current source before acting — files may have moved:

- **Media never rendered (critical).** No `<video>`/`<audio>`/`srcObject` exists anywhere in `src`; `ActiveCallPanel` renders controls only. `CallManager.ontrack` assembles `remoteStream` and `CallContext` stores it, but nothing plays it — connected calls produce no audio and no self-view. The guide's own Step 3.4 also omits media elements; mirror any fix into the guide via Prompt 9.
- **No teardown on refresh/tab/window close.** `MainViewApp.tsx` only destroys `CallManager` on React unmount. Add a `beforeunload`/`pagehide` (or Electrobun window-close) handler that calls `hangup()` so the remote gets a hangup message and `call-ended` is broadcast over `BroadcastChannel`.
- **Busy/auto-decline unreachable for distinct callers.** `CallSignaling.handlePost` drops any post whose `senderId !== expectedUserId` before `handleOffer`'s busy branch runs, so an offer from a *different* user while in a call is silently discarded (caller rings to timeout). The `decline:busy` path never fires.
- **`senderId` is self-attested and unauthenticated.** It lives in `post.props` (`from_webhook: "true"`), not the authenticated `post.user_id`. The `expectedUserId` check only isolates the active session — never trust `senderId` for display identity or gating, and document the limitation.
- **Early ICE candidates can be dropped.** `handleIceCandidate` returns silently when `peerConnection` is null instead of pushing into `pendingIceCandidates`.
- **Stats churn the whole call subtree.** `onStatsUpdate → setStats` mutates the shared context value every second, re-rendering every `useCall()` consumer — move stats to a separate subscription.
- **Session recovery is a stub.** `checkForOrphanedSession` emits a generic `unknown`-code error (rendered by `CallErrorToast` as "Call failed. Try again.") and clears storage; it does not resume.
- **`isWebRtcCallPost` typed guard exported but unused.** Timeline/routing use inline `post.type === "custom_webrtc_call"` / `!== "custom_webrtc_call"` checks (`useMainViewEvents.ts` routes to `handleIncomingPost`; `MainViewApp.tsx` filters the timeline); using the guard would also drop malformed call posts.
- **No unit tests for WebRTC core logic.** `CallSignaling` validation/batching, ICE buffering, the timeline filter predicate, cleanup, and recovery are untested; the pure-logic pieces are unit-testable without browser APIs.
- **Guide inaccuracies for Prompt 9:** Step 3.4 omits media elements; `createOffer` uses deprecated `offerToReceiveAudio/Video` instead of transceivers; `IncomingCallToast` countdown is hardcoded 45s rather than `config.answerTimeout`.

## Verification

```bash
./node_modules/.bin/tsc --ignoreConfig --noEmit --jsx react-jsx --target ESNext --module ESNext --moduleResolution bundler --lib ESNext,DOM --strict --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noUncheckedSideEffectImports false <touched-tsx-files>
```

Run focused tests separately when a nearby test pattern exists, for example `bun test src/mainview/mattermostApi.test.ts` after changing Mattermost API post creation. Still run `bun run typecheck` and report exact blockers if it fails; in this repo, TypeScript 7 currently reports missing type declarations for CSS side-effect imports such as `./index.css`, `./Sidebar.css`, and package CSS files.

## Commit hygiene

- Commit only source/docs/test files intentionally changed.
- Leave `.dirge/sessions/*`, skill edits, and other tool artifacts unstaged unless explicitly requested.
- Close the Beads issue after focused verification passes, then commit if the user asked for a commit.
