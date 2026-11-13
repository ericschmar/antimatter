[x] Channel headers -> uppercase
[x] Channel headers -> move count to be right aligned, and the dropdown arrow to be to the left of the header name
[x] Channels -> The padding looks slightly too big for the font size. 
[x] Channels -> in general, reduce the foint weight a little bit for the channels and headers
[x] Move our active server to a drop down menu that will sit on the same row as the stop lights. The active selection should show the server name, not url
[x] On the same row as the server drop down, but alignt to the right of the side bar, add our logged in user avatar, with a status indicator (using the mattermost api for keeping that updated)
[x] Create a generic avatar/status loader that can be used to load user's avatarts. Ensure caching and bast practices here so we don't redo the work all the time
[x] At the top of the side bar, under the server/user, but before the first channel group, add a placeholder search bar
[x] Implement the concept of persisted favorite channels; add a context menu to right click a channel to favorite it. Favorite channels are grouped at the top above the "channels" group
[x] Add user's avatars and status to the "direct messages" grouping
[x] I created a rust blobatar library. Let's use that for fallback when a user doesn't have a avatar
[x] We also need to add a special case to add an avatar for a DM that is with yourself
[x] For channels that have unread messages, can we also make the channel name bold
[x] Update the header for a selected channel to remove the status stuff and reload button. 
[x] Channel Header -> Channel name left aligned; Avatar horizontal stack (max 5) with statuses & total user count right aligned
[x] Message timeline -> Use the First/Last name of user, not their user name
[x] Message timeline -> Include timestamp (ex: 12:34 pm) 
[x] Message timeline -> Add separator between days 
[x] Message timeline -> add status indicator to the left of users
[x] Message timeline -> onHover message row, highlight the background subtly
[x] Channels -> add right click option to archive a channel. archive puts it in a new category at the bottom of the channel sidebar. when new messages arrive in an archived channel, move it back to the proper category
[x] Update our avatars to use the blobatars, rn they fallback to just the first letter of the name. 
[x] for the avatar stack, there should be a slight outline to the avatars
[x] the avatar stack overlays the member count
[x] remove the "disconnect session" button
[x] The channel header text should be larger
[x] message timeline -> the time is not aligned with the user's name, it's slightly higher
[x] message timeline -> slightly increase the width of the user + time to handle longer names
[x] channel sidebar -> increase the default width slightly
[x] for multiline messages, the status/name/date should be aligned at the top of the message
[x] add scroll bar to the message list and channel side bar
[x] make chat loader be centered horizontally
[x] control row height through "Message spacing" setting
[x] show user's avatars instead of the status icon (controlled by setting)
[x] hook up "send" button to the enter key press
[ ] fix: unread channel does not have channel name in bold.
