# Parity Matrix

## Data entities

- User: ID, username, optional names/nickname/email/position.
- Status: user ID, online/away/dnd/offline, manual/activity fields.
- Team: ID, name, display name, description.
- Channel: ID, team ID, name/display name, `O/P/D/G`, timestamps, header/purpose.
- Member: channel/user IDs, roles, view/message/mention counts.
- Post: ID/timestamps/delete state/user/channel/root/message/type/props/metadata/pending/failed/client ID.
- File: ID/name/MIME/extension/dimensions/preview availability.
- Reaction: user/post/emoji/timestamp.
- Custom poll: Matterpoll post type `custom_matterpoll`; `props` hold the poll ID and attachments (question, vote actions, counts when `--progress` is used).

## Capability checklist

- [ ] PAT / password / SAML SSO
- [ ] Team and channel navigation
- [ ] DMs and group DMs
- [ ] Channel view/unread/mentions/presence
- [ ] Favorites, archive, local order/emoji/collapsed sections
- [ ] Tabs, temporary previews, persisted valid workspace (split panes: decided non-goal)
- [ ] History, scroll anchors, typing, websocket reconnect
- [ ] Markdown, attachments, image handling, preview
- [ ] Send/reply/edit/delete/retry
- [x] Emoji reactions, custom poll create/vote
- [ ] Composer formatting/mentions/drag-drop/emoji/Giphy
- [ ] Search and command palette
- [ ] Notifications/settings/themes
- [ ] Experimental direct calls

## Implementation status (issue #5, as of this change)

- Implemented: Cargo CI gates (fmt, clippy, locked tests, headless and UI-lint checks), unsigned Rune native bundle build and metadata/binary check, release workflow publishing that unsigned bundle.
- Missing: signing, hardened runtime, notarization, bundled privacy manifest, third-party notices, update path, and Swift/Xcode product file retention decision.
- Blocked (needs native hardware or credentials): Keychain CRUD with signing entitlements, SAML callback registration and delivery, live-server auth and websocket reconnect, native notifications, VoiceOver/IME accessibility, singleton settings/multiwindow behavior, macOS 14+ minimum validation.
- Not a migration-complete claim: the Rune app implements only a PAT/password conversation slice with headless checks; the checklist above remains the authority.
