---
name: antimatter-toast-notifications
description: Add or route notifications in Antimatter's ChatShell — bottom-right update-toast variants, the inline error bar, and error classification (e.g. RPC timeouts). Use when adding a toast, changing where an error renders, or testing ChatShell notification output.
---

# Antimatter toast notifications

## Notification surfaces (all in src/mainview)

- **Inline error bar**: anything stored via `uiActions.setError(string | null)` (src/mainview/state/uiStore.ts) renders in ChatShell.tsx as `<div className="inline-error">` with a Dismiss button calling `uiActions.setError(null)`. `ui.error` is also read by MainViewApp for the auth screen.
- **Bottom-right toast stack**: shared `.update-toast` class (src/mainview/index.css, ~line 472; fixed, right/bottom 20px, width 320px, z-index 60). Variants append a second class:
  - `network-outage-toast` — shown when `ui.wsStatus` is `disconnected` or `error`
  - `rpc-timeout-toast` — danger variant (`.rpc-timeout-toast` overrides border-color/color with `--danger-border`/`--danger-text`)
  - `.update-toast.stacked` shifts the network-outage toast to `bottom: 118px` when the app-update toast is visible.
- **Top-right toasts**: CallErrorToast.tsx and IncomingCallToast.tsx (WebRTCCallUI.css, `top: 72px`) — separate components, not part of the update-toast stack.
- LSP diagnostics in untouched files (e.g. a stale unused import in `chatWorkspace.test.ts`) appear after edits but don't fail `bun run typecheck`; don't chase them as blockers.

## Routing an error to a toast instead of the bar

All errors funnel through `uiStore.error`; classification happens at render time in ChatShell:

1. Add a small predicate that returns the message when it should be a toast, `null` otherwise. Match the string EXACTLY — Electrobun rejects timed-out RPC requests with exactly `"RPC request timed out."` (thrown from `node_modules/electrobun/dist/api/shared/rpc.ts` when `maxRequestTime` expires; the app sets 30000ms in src/mainview/app/rpc.ts). Anything looser than `===` captures unrelated errors.
2. Gate the bar: `{ui.error && !toastError ? (<div className="inline-error">…) : null}`.
3. Render the toast next to the other toasts (just before `<CallErrorToast />`), reusing `.update-toast` + `.update-toast-body` + `.update-toast-dismiss` markup and the `X` icon from lucide-react. Compute `stackedToastCount` from the other visible toasts and set inline `bottom: 20 + stackedToastCount * 98` when nonzero.
4. Add the variant CSS next to `.update-toast.stacked` in index.css.

## Testing
ChatShell.test.tsx renders with `renderToString` (react-dom/server) after `mock.module`-ing `./rpc`, `../storage`, `../components/MessageComposer`, and `../components/ChatWorkspace`. Extend the `renderChatShell` options object with the state you need (e.g. `error?: string | null`) and apply it via `uiActions.setError(options.error ?? null)` before render (after `chatWorkspaceActions.reset()`). Assert on the HTML string: `toContain("update-toast rpc-timeout-toast")`, `not.toContain("inline-error")`, plus a companion test that a generic error still lands in `inline-error`.
## Verification

```bash
bun test src/mainview/app/ChatShell.test.tsx
```

Full gates after changes: `bun test`, `bun run typecheck`, `bunx biome check <touched files>` — run each bare (no trailing pipe) and confirm exit 0.
