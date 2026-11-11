use crate::state::*;
use antimatter_services::conversation::{self, Intent, Update};
use rune::TextEdit;

impl State {
    pub(crate) fn dispatch(&mut self, intent: Intent) -> bool {
        if self
            .intents
            .as_ref()
            .is_some_and(|sender| sender.try_send(intent).is_ok())
        {
            true
        } else {
            self.error = Some("Service is busy. Try again.");
            false
        }
    }

    pub(crate) fn load(&mut self, channel: String) {
        if !self.ready
            || self.busy
            || self.submitted
            || self.pending.is_some()
            || self.recovered_pending
            || (self.durable.is_none() && !self.draft.text.is_empty())
        {
            return;
        }
        if self.synthetic {
            if self.channels.iter().any(|c| c.id == channel) {
                self.note_open(&channel);
                self.channel = Some(channel.clone());
                self.posts.retain(|p| p.channel_id == channel);
            }
        } else if self.durable.is_some() {
            self.checkpoint(AfterCheckpoint::Load(channel));
        } else {
            self.load_now(channel);
        }
    }

    pub(crate) fn load_now(&mut self, channel: String) {
        if self.dispatch(Intent::Load(channel.clone())) {
            self.note_open(&channel);
            self.channel = Some(channel.clone());
            self.navigation.channel_id = Some(channel.clone());
            self.draft = TextEdit::new(
                self.drafts
                    .iter()
                    .find(|d| d.pane_id == COMPOSER && d.channel_id == channel)
                    .map_or("", |d| d.text.as_str()),
            );
            self.posts.clear();
            self.ready = false;
            self.error = None;
        }
    }

    pub(crate) fn send(&mut self) {
        if !self.ready
            || self.busy
            || self.submitted
            || self.recovered_pending
            || self.pending.is_some()
            || self.channel.is_none()
            || self.draft.text.trim().is_empty()
        {
            return;
        }
        self.checkpoint(AfterCheckpoint::Send(self.draft.text.clone()));
    }

    pub(crate) fn apply(&mut self, update: Update) {
        match update {
            Update::Navigation {
                channels, unread, ..
            } => {
                self.channels = channels;
                self.unread = unread;
                self.prune_tabs();
            }
            Update::Unread(unread) => self.unread = unread,
            Update::Timeline { channel_id, posts } => {
                if self.channel.as_deref() == Some(&channel_id) {
                    self.posts = posts;
                }
            }
            Update::Upsert(post) => {
                if self.channel.as_deref() == Some(&post.channel_id) {
                    self.posts.retain(|p| p.id != post.id);
                    self.posts.push(post);
                    self.posts
                        .sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
                }
            }
            Update::Deleted {
                channel_id,
                post_id,
            } => {
                if self.channel.as_deref() == Some(&channel_id) {
                    self.posts.retain(|p| p.id != post_id);
                }
            }
            Update::Pending(pending) => {
                if pending.is_none() && self.pending.is_some() {
                    if self.durable.is_some() {
                        self.checkpoint(AfterCheckpoint::Acknowledge);
                    } else {
                        self.draft.clear();
                        self.submitted = false;
                    }
                }
                self.pending = pending;
            }
            Update::Ready(ready) => {
                self.ready = ready;
                if ready
                    && self.channel.is_none()
                    && let Some(channel) = self
                        .navigation
                        .channel_id
                        .clone()
                        .filter(|id| self.channels.iter().any(|c| &c.id == id))
                {
                    self.load_now(channel);
                }
            }
            Update::Connection(connection) => self.connection = connection,
            Update::Failed(failure) => {
                self.error = Some(match failure {
                    conversation::Failure::Send => {
                        "Send failed. Draft retained; check delivery before retrying."
                    }
                    conversation::Failure::Reconcile => {
                        "Delivery remains uncertain. No message was resent."
                    }
                    _ => "Could not refresh conversation. Reload to try again.",
                });
            }
        }
    }
}
