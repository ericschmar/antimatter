[x] don't display channel user count if it's 0 or 1. 

## reactions, replies, attachments, search
Review https://apron.chat/images/demo.png
Review https://github.com/hakergeniusz/emoxidize/blob/main/SPEC.md#4-main-window for a spec that defines an emoji window popup. I think we might have to roll our own?
[ ] for each message row, on mouseover, draw an absolute located action bar on the top right of the message that contains a reply, and emoji button for now. reply: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="80 152 32 104 80 56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M224,200a96,96,0,0,0-96-96H32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>  emoji: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="128" r="96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="92" cy="108" r="12"/><circle cx="164" cy="108" r="12"/><path d="M168,152c-8.3,14.35-22.23,24-40,24s-31.7-9.65-40-24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>
[ ] I like the reactions in that picture. a reaction pill should highlight its border if the current user also reacted that
[ ] Handle mattermost server-specific emojis as a category in our picker and within pills.  
[ ] Do NOT implement the full row highlight. Just highlight the text within a colored badge for "@here" and the "@<me>"
[ ] https://github.com/ZhangHanDong/url-preview for generating preview cards within the message
[ ] I really like the code block in that screenshot, so let's copy that 
[ ] I like image viewing opening in the default OS preview
[ ] For messages with multiple images, draw them as a stack, give them a little border radius, and when clicked on.. maybe a context menu with the different image names, and you can click on one and open it in the preview
[ ] I also like the reply UI in that screenshot, so let's do ours like that. 
[ ] attachments that aren't images/gifs/videos, we need to create a beautiful download ui element that contains the file name, file type, size, and a download button (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><path d="M184,128h40a8,8,0,0,1,8,8v64a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V136a8,8,0,0,1,8-8H72" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><line x1="128" y1="24" x2="128" y2="128" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><polyline points="80 80 128 128 176 80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="188" cy="168" r="12"/></svg>)
[x] Our search bar extends past the edge of the side bar--it needs to be contained to the width
[ ] cmd + k highlights the search bar
[ ] searching uses mattermost's search with a new page that is opened with the results. results need to look like our existing message row. clicking on a result will eventually take them to the channel, and scroll the channel to that location
