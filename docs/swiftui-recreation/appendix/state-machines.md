# State Machines

## Connection

`idle → connecting → connected → disconnected → connecting`.

`error` is an observable failure state, not a terminal replacement for reconnect. Explicit sign-out transitions to `idle` and prevents reconnect.

## Post send

`draft → uploading? → pending → confirmed`.

Any network/API failure transitions to `failed`, preserving draft content and attachments for retry. REST confirmation and websocket echo are deduplicated by server post ID/client ID.

## Pane

`temporary → durable` on pin. `temporary → replaced` when selecting another sidebar channel. `durable → closed` on close. A closed pane cancels owned work and removes its leaf from the tree.

## Call (deferred)

`idle → initiating → ringing → connecting → connected → idle`; inbound begins `incoming`. Decline, timeout, permission denial, peer failure, and remote hangup must release media tracks and signaling state.
