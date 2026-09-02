# Risk Register

- **Mattermost SSO variations:** validate with target servers early; isolate callback mechanics in `SSOCoordinator`.
- **Workspace AppKit bridge complexity:** define and test tree invariants before visual implementation; do not serialize raw AppKit object graphs.
- **Rich Markdown editor scope:** start with Markdown source model and upgrade to `NSTextView` bridge only when formatting requirements demand it.
- **Timeline performance:** measure before custom virtualization; anchor restoration and image-size reservation are requirements either way.
- **Attachment security:** never expose tokenized URLs in logs; use authenticated downloads and user-initiated external opening.
- **Nibware visual drift:** require token replacement and visual review; reject bubbles/cards regardless of implementation convenience.
- **Calls:** current feature is exploratory; gate behind explicit experimental status and a native WebRTC feasibility decision.
