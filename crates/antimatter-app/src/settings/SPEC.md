---
id: antimatter-rust-settings
type: module-design
title: Rust settings window contract
status: draft
parent: antimatter-rust-runtime
references: [antimatter-theme, antimatter-rust-services]
---

# Rust settings window contract

This spec translates the Swift Settings window (`Sources/AntimatterApp/SettingsView.swift`,
its supporting `WorkspaceTheme.swift` value types, `ProfileSettingsForm.swift` and
`AccountSettingsViewModel.swift`) and the singleton-window decisions in
[the settings window design](../../../docs/design/2026-10-08-settings-window-design.md)
into a Rune contract. It supersedes only the SwiftUI/AppKit prescriptions there:
the `WindowGroup`, `openWindow`, `@AppStorage`, `NavigationSplitView` and sheet
mechanics. The singleton, `Command-,`, account-menu entry, Settings-owned session
binding, `780 x 540` default size and "no in-window replacement" decisions remain
authoritative and are restated below.

Status is **draft**: this is the inventory and target contract. Nothing here is
implemented, and no Swift setting is yet read or written by the Rust app. The
per-control **Wiring** column and the summary below say which controls are wired
when implementation lands.

## Scope and parity

Every Swift Settings control is in scope as a Rust control with the same label,
default, value set and effect. Where the effect depends on a feature that does not
exist in Rust yet (notification delivery, timeline rendering, avatars, server
profile writes, server notification preferences), the control is still shown and
persisted, and its wiring is marked **Deferred**. Deferred controls must not claim a
visible effect.

The one Rust-only control is **Theme**, which replaces the Swift "Follow system
appearance" toggle (see Appearance). No other control without a Swift counterpart is
in scope.

Out of scope: splits (decided non-goal), Settings as an in-window page, and any
rebinding of keyboard shortcuts.

## Window

- One independent native window, keyed `settings`, created with `rune::App::window`
  (`WindowSpec`) in the same process as the workspace. `WindowHandle::open()`
  activates it when it exists and creates it otherwise. There is never a second
  Settings window.
- Opened by the `Settings…` menu/command, `Command-,`, and the account menu. All
  three call the same open action.
- Default size `780 x 540` points; the frame is otherwise left to Rune/macOS.
- Closing hides it and runs its `on_close`; reopening shows the same state. The
  Settings window never keeps the app alive alone.
- The window is not a Kit `Page` inside the workspace and does not replace the
  workspace.
- Signed-out state: when no session is connected, the account-bound sections (Profile,
  Notifications server preferences and channel levels, Accounts "Active" marker) show
  an inert message and never retain the previous server's data. Global sections stay
  available.
- Window-level keys: `Command-W` closes this window only.

## Sections

Sidebar order matches Swift. Each section has a title, a one-line subtitle and the
controls below. Section titles and subtitles are reproduced exactly.

### General (`general`)

Title "General". Subtitle "Set up the essentials for your Antimatter workspace."

| Control | Storage key | Default | Values | Effect | Wiring |
| --- | --- | --- | --- | --- | --- |
| Message font size | `messageFontSize` | 12 | integer 10–20, step 1 | Timeline body size. Value row shows `N pt`. | Deferred |
| Message grouping | `messageGroupingIntervalMinutes` | 5 | integer 0–60, step 1 | Consecutive posts by one author within this many minutes are grouped. Value row shows `Off` at 0, else `N min`. | Deferred |

### Appearance (`appearance`)

Title "Appearance". Subtitle "Control the density and visual treatment of your timeline."

| Control | Storage key | Default | Values (label) | Effect | Wiring |
| --- | --- | --- | --- | --- | --- |
| Accent color | `accentColor` | `oceanBlue` | `onyx` (Onyx), `coral` (Coral), `oceanBlue` (Ocean Blue), `fern` (Fern), `amber` (Amber), `violet` (Violet) | Accent for selection, primary buttons and the profile camera badge. Shown as swatches with names and selected state. | Deferred |
| Font | `appFontFamily` | `system` | `system` (System), `rounded` (Rounded), `serif` (Serif), `monospaced` (Monospaced) | App font family. | Deferred |
| Theme | `theme` | `system` | `light` (Light), `dark` (Dark), `system` (System) | Selects the app theme. See Theme below. | Live |
| Use compact message timeline | `compactTimeline` | on | boolean | Compact ledger rows. | Deferred |
| Message spacing | `timelineMessageSpacing` | `medium` | `small` (Small), `medium` (Medium), `large` (Large) | Vertical padding per message: 1, 3 or 6 points. | Deferred |
| Show user avatars | `showTimelineAvatars` | on | boolean | Avatar column in the timeline. | Deferred |

Theme resolution: `dark` maps to `Theme::Warm`, the Rust app's current launch theme,
and is the default dark appearance. `light` maps to `Theme::Light`. `system` resolves
to `dark` or `light` from the OS appearance at launch and when it changes. The Swift
app forced dark everywhere and its "Follow system appearance" toggle (storage key
`followSystemAppearance`, default off) was stored but never read, so there is no
Swift behaviour to preserve. `Theme::Default` and `Theme::HighContrast` are not
offered; they stay internal Rust variants. Rune does not expose an OS appearance
query at the pinned revision, so `system` depends on a platform query that is not yet
available; until it exists, `system` resolves to `dark`, and this is stated in the UI
detail text rather than implied. The `followSystemAppearance` key is not written by
the Rust app.

The accent values are the Swift RGB anchors: onyx `(0.13, 0.13, 0.14)`, coral
`(0.90, 0.22, 0.27)`, ocean blue `(0.00, 0.48, 1.00)`, fern `(0.20, 0.70, 0.42)`,
amber `(0.98, 0.62, 0.11)`, violet `(0.60, 0.35, 0.85)`. Accent drives the Kit primary
and selection tokens only (primary buttons, selected sidebar rows, selected swatch,
profile camera badge). It does not recolour message colours, which keep their
graphite/green/amber identity. Accent is supplied through `antimatter-theme`; the
settings window itself uses the Antimatter tokens, not a second palette.

### Notifications (`notifications`)

Title "Notifications". Subtitle "Control local delivery and Mattermost preferences for
this account."

Local delivery:

| Control | Storage key | Default | Effect | Wiring |
| --- | --- | --- | --- | --- |
| Enable notifications | `notificationsEnabled` | on | Master switch for local delivery. | Deferred |
| Play notification sounds | `notificationSoundsEnabled` | on | Disabled while notifications are off. | Deferred |

Mattermost preferences for the connected account (read and written through the
Mattermost `preferences` API, category `notifications`, values `"true"`/`"false"`).
The Rust services crate has no preference API yet, so these are Deferred:

| Control | Name | Default | Wiring |
| --- | --- | --- | --- |
| Desktop notifications | `desktop` | from server | Deferred |
| Email notifications | `email` | from server | Deferred |
| Push notifications | `push` | from server | Deferred |
| Mention notifications | `mention` | from server | Deferred |
| Thread reply notifications | `thread` | from server | Deferred |

Channel notification levels, under the heading "Channel notification levels" (shown
only when the active server has joined channels). Category `channel`, name = channel
ID, value:

| Value | Label |
| --- | --- |
| `default` | Default |
| `all` | All messages |
| `mention` | Mentions |
| `none` | Muted |

Each joined channel of the active server is listed in navigation order, with its
display name and a level picker. Missing server values read as `default`. Wiring:
Deferred.

A server preference write is applied only after the server accepts it. A failed
write shows the error on the row and keeps the previous value.

### Workspace (`workspace`)

Title "Workspace". Subtitle "Choose how conversations open in your workspace."

| Control | Storage key | Default | Effect | Wiring |
| --- | --- | --- | --- | --- |
| Open channels as previews | `workspaceOpenPreviews` | on | Single-click channels open as preview tabs. | Deferred |
| Open direct messages in a new window | `automaticallyOpenDirectMessagesInNewWindow` | off | Opening a DM uses a new window. The value is stored now and takes effect when multi-window workspaces exist. | Deferred |

### Keyboard Shortcuts (`keyboardShortcuts`)

Title "Keyboard Shortcuts". Subtitle "Use these shortcuts to move quickly around
Antimatter."

Read-only reference. Rows are labelled `Title: shortcut` for assistive technology.

| Action | Shortcut |
| --- | --- |
| Open command palette | `⌘K` |
| Close active chat | `⌘W` |
| Previous chat tab | `⌘[` |
| Next chat tab | `⌘]` |
| Focus sidebar | `⌥⌘1` |
| Focus conversation | `⌥⌘2` |
| New workspace window | `⇧⌘N` |
| Open settings | `⌘,` |

The list is documentation, not a rebinding surface. Any shortcut change is a
separate contract.

### Profile (`profile`)

Title "Profile". Subtitle "Manage the identity visible to people in this Mattermost
server."

Form for the connected user's Mattermost profile:

- Avatar: a 72 pt circle showing the current avatar or a placeholder, with a camera
  badge in the accent color. A "Choose photo" button opens an image picker and
  uploads the avatar.
- Fields: "First name", "Last name", "Nickname", "Username", "Email", "Custom status"
  (text), and "Status" (picker: `online` "Online", `away` "Away", `dnd` "Do not
  disturb", `offline` "Offline").
- Save: one "Save profile" button. While a save is in flight it reads "Saving…" and
  is disabled. A server error is shown below the form and keeps the edited values.

Editing never changes another account's profile. Wiring: Deferred (no Rust profile
API yet).

### Accounts (`account`)

Title "Accounts". Subtitle "Switch between signed-in Mattermost servers or add
another account."

Lists saved accounts. Each row shows the server host (falling back to the full URL)
and the full server URL. The connected account shows an "Active" marker. Other rows
offer "Switch" and "Disconnect" (destructive). An "Add account" action follows the
list.

- Switch is a checkpointed account change through the existing services contract
  (`select`/`restore`).
- Disconnect is the existing sign-out workflow and keeps its failure wording.
- Add account routes to the sign-in flow; the Settings window stays open.

Wiring: Live. These rows read the existing saved-account registry.

## Persistence

- Global preferences (General, Appearance, Notifications local, Workspace) are one
  versioned record in the Rust app's data directory, `settings.json`, with a
  `version` field and an explicit default for every missing key. Writes are atomic
  and serialized through the existing persistence thread. An unreadable or
  unknown-version file fails closed: defaults are used for display, the file is
  preserved, and a visible error is shown.
- Account-scoped data (Mattermost preferences, profile) is never cached in
  `settings.json` and is read from the server for the connected account only.
- Preferences are not copied from Swift `UserDefaults`. Migration is decided below.
- Saving a control applies it immediately and persists it; a failed write reverts
  the control to its last persisted value and shows an error.

## Wiring summary

- **Live** when implementation lands: Theme (applies to the launch theme), and the
  Accounts section (Switch, Disconnect, Add account).
- **Deferred** (persisted or shown, no visible effect until the owning feature
  lands): every General control, Accent color, Font, Compact timeline, Message
  spacing, Show user avatars, every Notifications control (local, server and channel
  levels), both Workspace controls, and the whole Profile form.
- **Read-only**: Keyboard Shortcuts.

## Accessibility and keyboard

- Sidebar is a list with section names; each section is reachable with the arrow
  keys and selected by Return or Space.
- Every control has an accessible label equal to its visible title. Toggles expose
  on/off state; swatches expose name and selected state; steppers expose value.
- The shortcut reference exposes `Title: shortcut` as one element per row.
- Focus starts on the sidebar when the window opens and returns to the invoking
  control's window when closed.

## Window

- The window is hidden at launch and shows only when the user opens it (menu,
  `Command-,`, or the workspace's Settings action). Startup never reveals it.
- It uses the same full-size titlebar band as the workspace (`workspace::TITLEBAR`).
  Sidebar and detail content start below that band so the traffic lights never
  overlap a row or heading; the band is a window-drag region.
- Clicking a sidebar row selects its section and updates the detail page. The switch
  is instant: no entrance, fade or slide on the new page.
- Setting labels (row titles, choice labels, sidebar titles, status tags such as
  "Deferred" and "Active") use the Kit `text_small` style. Page titles and subtitles
  keep their heading styles.

## Verification

- Headless: keyed scripts open the window twice and assert a single window; change
  each control and assert persisted values and the effect where one exists; assert
  Deferred controls do not change visible state.
- Unit: default values, value-set round-trip, missing-key defaults, corrupt-file
  fail-closed, and accent RGB anchors match the table above.
- Native (not claimed by headless tests): singleton activation from the menu and
  `Command-,`, red close and `Command-W`, frame restoration, VoiceOver names for the
  window, sidebar and each channel-level picker.

## Decided

- **Theme.** A Light/Dark/System picker replaces the Swift follow-system toggle
  (see Appearance). `system` depends on an OS appearance query that Rune does not yet
  expose at the pinned revision.
- **Migration.** None. The Rust app starts from defaults; the Swift app is untouched.
- **Accent scope.** Kit primary and selection tokens only (see Appearance).
- **Deferred controls.** See the Wiring summary. They are persisted now and have no
  visible effect until their owning features land. Each is wired up later.

## Open decisions

None. The `system` theme's OS query is a dependency to resolve when it is implemented.
