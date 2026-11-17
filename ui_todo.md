[x] don't display channel user count if it's 0 or 1. 

## reactions, replies, attachments, search
Review https://apron.chat/images/demo.png
Review https://github.com/hakergeniusz/emoxidize/blob/main/SPEC.md#4-main-window for a spec that defines an emoji window popup. I think we might have to roll our own?
[x] for each message row, on mouseover, draw an absolute located action bar on the top right of the message that contains a reply, and emoji button for now. reply: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="80 152 32 104 80 56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M224,200a96,96,0,0,0-96-96H32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>  emoji: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="128" r="96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="92" cy="108" r="12"/><circle cx="164" cy="108" r="12"/><path d="M168,152c-8.3,14.35-22.23,24-40,24s-31.7-9.65-40-24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>
[x] I like the reactions in that picture. a reaction pill should highlight its border if the current user also reacted that
[x] Handle mattermost server-specific emojis as a category in our picker and within pills.  
[x] Do NOT implement the full row highlight. Just highlight the text within a colored badge for "@here" and the "@<me>"
[x] https://github.com/ZhangHanDong/url-preview for generating preview cards within the message
[x] I really like the code block in that screenshot, so let's copy that 
[x] I like image viewing opening in the default OS preview
[x] For messages with multiple images, draw them as a stack, give them a little border radius, and when clicked on.. maybe a context menu with the different image names, and you can click on one and open it in the preview
[x] I also like the reply UI in that screenshot, so let's do ours like that. 
[x] attachments that aren't images/gifs/videos, we need to create a beautiful download ui element that contains the file name, file type, size, and a download button (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M184,128h40a8,8,0,0,1,8,8v64a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V136a8,8,0,0,1,8-8H72" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="128" y1="24" x2="128" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="80 80 128 128 176 80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="188" cy="168" r="12"/></svg>)
[x] Our search bar extends past the edge of the side bar--it needs to be contained to the width
[x] cmd + k highlights the search bar
[x] searching uses mattermost's search with a new page that is opened with the results. results need to look like our existing message row. clicking on a result will eventually take them to the channel, and scroll the channel to that location

----- User Review -----
[x] Emoji replies are a little too small, they're hard to read. 
[x] There's an extra padding under a message--I presume from adding the emoji row but it's there even when there are no emojis, so it adds extra space between messages
[x] Our custom code blocks are not being rendered, I only see a copy icon. I want them to look like those in the apron demo
[x] Our link previews are also not being rendered (test url: https://apnews.com/article/microsoft-outage-outlook-email-365-status-down-d92547a821930290db2964388016979a) I guess it works with https://mattermost.com/ so that's weird
[x] I can't test replies beause our reply button doesn't do anything. It should add a `> quotted text` right above the composer, and then a user can add a reply that way
[x] Our emoji window -> "search Emoji" is not centered in the search box"; our custom mattermost category button extends outside the bounds of the window. 
[x] add an image attach button to the message composer that opens a native attachment window (also support dropping files https://github.com/anomalyco/rune/tree/dev/examples/drop-files)--when a file is attached, show a pill above the composer with the file name, and an "x" that removes the file from being sent. I guess we need a button for images and one for files. (img: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><rect x="32" y="48" width="192" height="160" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="156" cy="100" r="12"/><path d="M147.31,164,173,138.34a8,8,0,0,1,11.31,0L224,178.06" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M32,168.69l54.34-54.35a8,8,0,0,1,11.32,0L191.31,208" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>) (file: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M160,80,76.69,164.69a16,16,0,0,0,22.63,22.62L198.63,86.63a32,32,0,0,0-45.26-45.26L54.06,142.06a48,48,0,0,0,67.88,67.88L204,128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>)
[x] global search breaks our chat. It should open its own tab, that has a custom layout. Right now, it poisons our chat history, and switching between chats retains the search results. 
[x] make search cursor blink when it is focused
[x] add loading spinner to the right end of the search bar
[x] add a "cmd+k" little badge in the search bar to indicate there's hotkeys
[x] archived chats don't persist between app close/reopen
[x] I want to make our avatars a little bigger. they're hard to see right now

------- User Review --------
[x] The server dropdown should show a checkmark for the selected server
[x] Wire up the theme selector to the app so changing the theme, changes the accent color (also highlight the current accent)
[x] Change the font of our right-click context menu to be smaller
[x] Make double-clicking a channel pin it
[x] Add a tooltip to the channel's avatar stack that lists the users in the channel
[x] Add a "create channel" and "start dm" options in the sidebar 
[x] Wire up the Profile page
[x] Wire up interacting with the app as telling mattermost that we're active
[x] Finish and wire up the notifications section in the settings
[x] Archived chats are not persisted between runs
[x] Replying to images don't render anything in the root message body, but should just render the image name.

------- User Review ---------
[x] Add ledger caching so switching from channel A -> channel B -> back to channel A loads much faster
[x] The background color to the channel header is the same as the tabs above it, and the ledger too, so visually it's a little confusing. I think the header and tab background should be a slightly lighter color--maybe the same as the channel list?
[ ] Channel sidebar -> reply previews--I don't think we need the indicator of number of messages
[ ] Notifications -> Show user who sent the message + Channel and then a preview of the message
[ ] Are the live status indicators working? I see everyone with an orange dot including myself, despite knowing people are active. 
[ ] Can we hide scroll bars until the user actually scrolls?
[ ] Our server dropdown shows the connection url for servers we aren't connected to, not their names
[ ] Move the "create channel" and "start dm" to the top of each list so it's right under the category
[ ] When a user get's a DM, move the channel in the sidebar to the top of the DM list
[ ] typing in our composer randomly loses focus
[ ] after sending a message, retain focus in the composer
[ ] implement message editing
