---
id: antimatter-rust-runtime
type: module-design
title: Rune application and session runtime
status: active
parent: antimatter
depends-on: [antimatter-rust-services]
---

# Rune runtime contract

This source-adjacent spec records the existing Rust boundary, not additional
feature approval. [Root ownership](../../SPEC.md) and the approved replacement
sections in [architecture/data](../../docs/swiftui-recreation/04-native-architecture-and-data-model.md)
and [API/auth](../../docs/swiftui-recreation/05-mattermost-api-websocket-and-auth.md)
remain authoritative for shared contracts. Changes must reconcile both owners
and this implementation contract; source behavior does not supersede intent.
GitHub issues own execution status, not these specs.

## Source boundaries

The app is the `antimatter` binary crate. Modules: `state` (State, Login),
`session`/`checkpoint`/`timeline`/`auth` (`impl State` behaviour), `signin` and
`workspace` (views), `view` (root and hello scenes), `widgets` (kit wrappers),
`theme` (selects an [`antimatter-theme`](../antimatter-theme/SPEC.md) `Kit`),
`scenes` (synthetic proof data) and `tests`. `task dev` runs the native window with
`cargo run` and no hot reload; `task dev:snap` is the only `dx` hot-reload path.

- `main.rs`: Rune presentation, secure inputs and view intents; native execution
  creates one Tokio runtime. Fresh PAT/password sign-in validates `/users/me`
  before publishing an authenticated session. Fresh login is session-only unless
  Remember is explicitly enabled. Native startup reads only Rust registry/selection
  metadata; saved credential access and `/users/me` validation require an explicit
  saved-account click. Saved identity must match the validated user. SAML uses the
  retained native browser adapter and the same authentication completion path.
- `lib.rs`: `SessionScope` owns session generation and cancellation. Replacement
  or disconnect checkpoints durable state before cancelling the previous future
  and clearing rendered session data. Accepted persistence commands are not
  rolled back by cancellation; cancellation is disabled during auth publication.
  Every background completion checks its generation before changing UI state.
- [Service contract](../antimatter-services/SPEC.md): background REST/socket/conversation work.
  Publish small updates through `AppHandle::update`; never perform blocking
  filesystem/Keychain work, HTTP or wire decoding on the UI thread.

## Conversation interaction

Enqueue successfully before changing the selected channel or locking a send;
queue failure retains the prior timeline and draft. Serialize channel loads and
prevent selection changes while loading or while pending delivery exists.
Durable channel/account transitions checkpoint pane/channel drafts first;
session-only channel transitions keep drafts in memory per channel; account
transitions and disconnect discard them with the existing warning.
Concurrent workspace panes (splits) are a decided non-goal, so one active conversation is the intended model.

Lock send/attach controls immediately after send enqueue, not after its acknowledgement.
The composer stays editable while locked, so typing never drops focus; only the send
path is blocked. Refresh does not disable the send, attach or toolbar controls: `send()`
still refuses while not ready. At the pinned Rune version, `disabled`/`read_only` alone do not prevent editing:
Disabled buttons are inert and also guard their handlers. Only `Ready` controls refresh readiness; a pending
acknowledgement cannot unlock an unfinished refresh. Successful acknowledgement
clears the submitted draft only after its durable acknowledgement checkpoint;
failure retains it. Durable sends checkpoint a reserved `conversation-pending`
pane before enqueue. A clean close before enqueue rolls that marker back to an
ordinary draft; accepted sends keep it. Restored markers never authorize resend
and currently lock send/switch/sign-out pending a later recovery UI. Marker text
is retained, but full pending UUID/reconciliation recovery remains outstanding.

`Persistence` owns one dedicated blocking-I/O thread. Rune turn completion
autosaves changed drafts/navigation at most once a second, and the poll tick flushes
the trailing edit. Background saves do not set `busy`, so typing never locks the
composer or toolbar; they serialize through `write_task`, and a save waits for any
in-flight write. Completions are serialized, preventing stale
close snapshots from restoring acknowledged markers. Clean close drains writes;
Rune cannot veto close, so disk failure or a crash before commitment can retain
only the last durable edit. The UI warns about this ceiling; it is not a data-loss
guarantee. Explicit save/retry remains available. Sign-out cancels the matching
authenticated identity even for a session-only connection to a saved account.
Session-only disconnect warns that in-memory drafts/pending state are discarded.

## Typing indicator

Typing is realtime and scoped to the open channel. While the draft has text, the poll tick
sends `Intent::Typing` at most once every 2 seconds, and only when the draft text has changed
since the last successful send; a dropped send is retried on the next tick. The parent is the
reply target's thread root, or the target itself, and an empty draft sends nothing. Incoming
typers are recorded with their last-seen time and expire after 5 seconds. Switching channels
clears both the typers and the last-sent draft. The indicator is a footer line above the
composer ("X is typing", "X and Y are typing", "X and N others are typing", using display
names and falling back to the user ID). Synthetic and not-ready sessions send nothing.

## Thread previews

The sidebar lists followed threads with unread replies above the channel sections, grouped by
channel under a total badge. Each row shows the root's first line, its next non-empty line, and
the latest reply (author and first line). The conversation worker publishes `Update::Threads`
after refresh, socket connect and thread/reply socket events; lookups are advisory and a failure
keeps the last list. Pressing a row opens the channel (honouring the usual load guards), scrolls
to the latest reply when it is in the loaded page, drops the row at once and marks the thread read
on the server. Scene: `workspace-threads-proof`.

## Rendering and export boundary

Native default is the conversation entry. Headless default and the `hello`/`on`
scenes preserve the hello switch and spring check. `auth-proof` uses only fake
secure values; `conversation-proof` renders only synthetic conversation data.
Headless initialization creates no service runtime and accesses no account store.
`--real-account` rejects headless execution, and native execution rejects tracing.
Never export credentials or real conversation/account data into test artifacts.

## Kit-backed workspace foundation

The approved first workspace slice uses `rune-kit` at the same exact git revision
as Rune. Reuse generic controls/sidebar mechanics and the existing Rune editor, not OpenCode theme assets.
A shared presentation theme maps the owning Antimatter semantic colors and
compact typography/geometry onto Kit. The native conversation entry presents
a 248 pt resizable sidebar, compact keyed channel rows, 32 pt title strip,
54 pt conversation header, and 176 pt metadata/8 pt gap message ledger.
Reuse existing load/checkpoint/send/retry paths; loading, queued send, ambiguous
delivery and restored markers keep their current guards. The composer stays editable
while those guards apply; they block send, not typing. Kit control replacement
must retain disabled-handler and accessibility checks.

Synthetic workspace scenes may demonstrate navigation, sidebar resizing and
locked/retry states without services, credential/storage access or OS actions.
Synthetic local transitions never publish real intents or modify durable state.
Sidebar width is window-local for this foundation; durable pane/layout and
preference restoration are subsequent work, not implied by presentation.
Incremental history (approved 2026-11-12): older history loads automatically, and only after the
user has scrolled by hand to the top of a channel (`scroll_watch_state` reports a hand scroll).
Opening a channel, a prepend anchoring the view, or a short channel never pages. The ledger
reports its offset and a hand-scroll flag through `on_scroll_offset` into shared atomics; a
sentinel row at the top takes that flag from its `on_layout` handler, consumes it, and requests
`load_older` when the offset is within 24 pt of the top, so one hand scroll buys one page. A
loading page shows Phosphor's spinner (`ph-spinner`, `antimatter-theme/src/loader.rs`) in place
of the sentinel; there is no load button. Requests are inert while busy,
submitted, pending, recovered, not ready, synthetic, or when no older history is known.
The ledger uses `scroll_anchor()` so prepended rows keep the visible row in place. Posts are
built with `virtual_rows`, so only rows in the mounted window exist; each row carries its day
header and reply quote. The emoji picker and multi-image menu are built once at the window root,
anchored to their post's trigger, and close when that post scrolls out of the window.
Synthetic scenes `workspace-history-proof`, `workspace-loading-older-proof` and
`workspace-scroll-history-proof` show the control, spinner and scrollable history; live
paging is not verified.

## Channel files panel

The channel header has a files toggle (key `channel-files-toggle`, Phosphor `FOLDER` icon, label
and tooltip "Show channel files" / "Close channel files") to the right of the member stack, 8 pt
away from the avatars. Pressing it toggles
`State::channel_files`; when open, a 264 pt `channel-files` panel sits to the right of the ledger
in the workspace row. The panel lists the files attached to the posts already loaded for the open
channel (`channel_files`, deduplicated by file id, in post order); it makes no request of its own.
Each row downloads through `State::download_file`, the same save path as message attachments. An
empty channel shows "No files in this channel yet." Scene: `workspace-channel-files-proof`. Only
loaded history is listed; files in older pages appear once that history is loaded.

This foundation slice does not implement rich
message actions; the independent Settings window is specified in
[settings/SPEC.md](settings/SPEC.md) (`antimatter-rust-settings`); tabs are specified below; splits are a decided non-goal. An in-window Kit
Page must not replace the independent native singleton.

## Rich composer

The composer follows Rune Kit's `rich_editor` example: a formatting bar (bold, italic,
strike, inline code, link, bullet/numbered list, quote, code block) over a `TextArea`
with highlighted code blocks. Underline and `@` pills are not offered. Markdown is the
only stored and sent form: `markdown.rs` converts between the editor's marks/blocks and
a line-based Markdown subset (no escaping), drafts and `Send` carry Markdown, and loading
a channel parses its draft back. The `Markdown` button swaps to an editable raw source
view; toggling converts in both directions and the bar is inert in source view. Locked
states lock the bar and send, but the editor stays editable. Known gaps: mention pills,
a mono font slot for code, and rendering of received messages.

GIF search needs a Giphy key. `giphy.rs` reads
`GIPHY_API_KEY` from the environment, else from the git-ignored `crates/antimatter-app/.env.local`
(a blank value falls through), once at launch. The composer's GIF button (Phosphor-style `GIF`
icon, key `gif-picker-open`) is always shown in the toolbar and is disabled (inert) when no key
is configured or the composer is locked. Pressing it toggles a popover anchored above the button
(`rune_kit::popover::anchored`, `Placement::TopStart`) with an outside-press scrim, modelled on the
emoji picker: a search field over a scrolling grid of thumbnails (`gif-grid`). Opening it
loads the featured (trending) GIFs; submitting the field searches, and an empty query returns
to featured. Thumbnails load in the background into the GIF image store (`gifs.rs`, separate from
the avatar cache). Picking a GIF
appends `![title](media-url)` to the draft as Markdown and closes the popover. It never sends.
The draft is text-only, so the GIF is not rendered inline in the composer; it appears as an
image only once the message is sent and displayed. The key is held in memory only and is not
written to settings or logs.

Message GIFs render in the ledger. Every `![alt](http(s) URL)` in a post's Markdown is
drawn by rune-kit's `Markdown::images` as the picture from the GIF store (`gifs.rs`, keyed by the
URL). Each picture is bounded to 320 x 240 pt with its aspect ratio kept (`image_frame` applies
`max_w`, `max_h` and `aspect_fit`), so a large GIF letterboxes inside that box rather than
filling the message column or window. Until it decodes, and when the fetch fails, the image shows
its alt text. Each post's GIF sources are fetched once in the background. A Mattermost proxy
link (`/api/v4/image?url=`) is fetched with the session through `Client::proxied_image`, which
follows only same-origin redirects, then any off-origin redirect target is fetched without the
credential. Direct Giphy links are fetched with `giphy::fetch_bytes` and no credential. The app's per-frame `poll` requests every post's GIF sources
(`State::fetch_post_gifs`), so a GIF starts downloading as soon as its post is loaded and
the picture replaces the alt text when it decodes. Non-image links keep their existing link-preview card.

## Unread and viewed state

The user approved this second issue #4 slice on 2026-11-10. Refresh requests each
navigated channel's `/users/me/channels/{id}/unread` counts (bounded concurrency)
and publishes them with `Navigation`; a failed or mismatched lookup keeps the last
known count, so counts are advisory and never block readiness. After a successful
load/refresh of the active channel the worker posts the channel-view endpoint
(previous channel recorded by the last load) and clears that channel locally only
when the server accepted it; failure is silent and retried by the next refresh.
`posted` events for other channels from other users add an advisory delta (a
mention only when the event's `mentions` names the current user); `channel_viewed`
clears a channel. Deltas are replaced by server counts at the next refresh/reconnect.
The sidebar shows `@N` for mentions or an unread dot otherwise. Counts are
session-only and never persisted. Per-pane unread remains later work.

## Sidebar grouping

The sidebar shows two collapsible sections: "Channels" (every non-direct channel of the
selected community) first, then "Direct messages" (kinds `D` and `G`, shown in every community). Each section header shows its count and toggles
its collapsed state; collapsed state is session-only and resets to expanded on launch.
Channel rows keep the `channel-<id>` keys, sit one indent level in, use the small
title font, and lead with the Phosphor `#` icon (`icons::HASH`); direct rows have no icon.
Rows are built in `channel_row` (not rune-kit's `SidebarRow`) so later designs, such as
reply previews under a channel, can change them. A row with unread messages or mentions
uses semibold, full-strength text; read rows use regular weight and muted text. Rows show the resolved DM name (see the services spec) when available.

The server dropdown sits on the traffic-light row, right of the lights, and is a fixed-width
`Select` trigger (rune-kit's inline trigger sizes to its label, so the width is set by the
app) that opens a `Menu` of the connected server's communities (Mattermost teams, shown by
display name, else name). The trigger shows the selected community and truncates before its
chevron; the first team is selected until the user picks another. Choosing an entry sets
`State::selected_team` without changing account. The sidebar lists only channels of the selected
community; direct and group messages stay visible in every community. Account switching is not
in this dropdown; it stays with the Settings account list and its guarded `switch_account`.

## Tabs (splits are a non-goal)

The user approved this third issue #4 slice on 2026-11-11 as "Tabs (no splits)".
It supersedes, for this window, the AppKit custom tab strip prescription in
`docs/swiftui-recreation/06` (section on the custom tab strip) with the same-pin
`rune_kit::TabStrip` in the 40 pt title band, keyed `tabs`/`t-{channel_id}`, role
`tablist`/`tab`. Product semantics from docs 03 and 06 stay in force: sidebar
select opens or reuses one temporary preview tab; double-clicking a sidebar row or
a tab, or the tab context menu "Keep tab open", makes it durable; opening an
existing durable tab activates it. The context menu also offers Close tab and Close
other tabs; Cmd+W closes the active tab through the window-level key hook (never the
window) and is consumed even when the last tab cannot close. Each tab shows a `#`
channel glyph and a hover close button; tab width follows the longest title, clamped
to 144-240 pt, and shrinks then scrolls on overflow. The app declares
`Titlebar::new(TITLEBAR)` so only `.window_drag()` regions move the window; without it
AppKit's native 40 pt band swallowed tab presses and drags. The last tab cannot be closed.
A tab is a conversation entry, so there is one active channel and one timeline, with
one draft per channel (the composer pane id plus channel id). Switching channels
snapshots the current draft into `drafts` (checkpointed first when durable, kept in
memory for session-only) and restores the target channel's draft. Tab activation,
close of the active tab and close-others reuse `load` and are refused under the
same guards (not ready, busy, submitted, pending, recovered or checkpoint retry);
a non-empty session-only draft no longer blocks switching. Only durable tabs persist,
as `Navigation.tabs` (ordered, unique, nonempty IDs, at most 32, `serde(default)`
so existing preferences restore with no tabs); an invalid list is rejected like
an invalid channel ID. Tabs whose channel is no longer navigable are dropped on
the next navigation update. Unread/mention status appears on inactive tabs.
Known gaps: the preview tab is not italic (the kit tab has no title-style hook;
it is described as "Preview tab" for accessibility). The user decided on 2026-11-11 that split panes will not be implemented;
docs 01, 03, 04, 06 and 08 record the same decision, and this runtime does not
reserve pane-tree or split-ratio state.

Debug-only development exception: debug builds (`cfg(debug_assertions)`) prefill the
server, login and password sign-in fields from git-ignored `.env.local`
(`ANTIMATTER_DEV_SERVER`, `ANTIMATTER_DEV_LOGIN`, `ANTIMATTER_DEV_PASSWORD`). The same
file may hold other keys, which the prefill ignores. Release builds compile this out, and
nothing is written to disk. This does not permit
plaintext credential storage; Remember and the Keychain rules are unchanged.

## Runnable verification

`cargo test --locked --offline --bin antimatter` checks the spring, immediate
composer lock including attempted paste, refresh readiness, enqueue failure,
stale-session rejection and Rune-driven loopback load/send/delivery checking.
`python3 scripts/rune-headless.py` checks synthetic rendering/accessibility,
secure-input redaction and export/trace rejection. Inspect rendered PNGs in
ignored `build/rune-headless/`; metadata is not visual or native parity proof.
`task ui:lint` (`scripts/ui-lint.py`) renders every scene at 420x400, 640x480,
960x640 and 1280x800 with `--chrome` and fails on overflow, text escaping its
parent, overlapping text, invisible inputs, floating full-width buttons and
traffic-light overlap; PNGs land in ignored `build/ui/` and must still be
inspected. `task verify` runs fmt, clippy, tests and both gates; `task precommit` runs it then deletes the generated PNG/JSON (`task clean`). Layout rules:
content clears a 40 pt titlebar band, the sidebar and main pane shrink, and
sign-in is a bounded scrolling card.

Native Keychain/browser callback delivery, authorized live-server conversation,
full pending-delivery recovery, legacy import UI and full workspace behavior
require separate checks and implementation; this contract grants no claim of
their completion. The native helper builds an unsigned, unregistered bundle with
`antimatter.ericschmar.dev` (the user-authorized Swift identity) and `mattermost`. Its app icon is
`assets/AppIcon.icns`, built from the Swift app's `AppIcon.appiconset` (the same artwork,
1024 px master in `icon.iconset`) and declared as `CFBundleIconFile` = `AppIcon` in
`Contents/Resources`; Rune's `AppSpec` has no icon field, so the bundle is the icon source.
Browser start fails closed unless the running main bundle declares both. Metadata
checks do not prove LaunchServices delivery or authorized live/SAML acceptance.
