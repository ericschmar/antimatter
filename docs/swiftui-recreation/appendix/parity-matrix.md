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
- Custom poll: question, option IDs/text, voter map; post type `custom_antimatter_poll`.

## Capability checklist

- [ ] PAT / password / SAML SSO
- [ ] Team and channel navigation
- [ ] DMs and group DMs
- [ ] Channel view/unread/mentions/presence
- [ ] Favorites, archive, local order/emoji/collapsed sections
- [ ] Tabs, temporary previews, split panes, persisted valid workspace
- [ ] History, scroll anchors, typing, websocket reconnect
- [ ] Markdown, attachments, image handling, preview
- [ ] Send/reply/edit/delete/retry
- [ ] Emoji reactions, custom poll create/vote
- [ ] Composer formatting/mentions/drag-drop/emoji/Giphy
- [ ] Search and command palette
- [ ] Notifications/settings/themes
- [ ] Experimental direct calls
