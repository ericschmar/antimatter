use crate::markdown::{from_markdown, to_markdown};
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
        {
            return;
        }
        if self.synthetic {
            if self.channels.iter().any(|c| c.id == channel) {
                self.drafts = self.snapshot();
                self.note_open(&channel);
                self.channel = Some(channel.clone());
                self.posts.retain(|p| p.channel_id == channel);
                self.restore_draft(&channel);
            }
        } else if self.durable.is_some() {
            self.checkpoint(AfterCheckpoint::Load(channel));
        } else {
            self.drafts = self.snapshot();
            self.load_now(channel);
        }
    }

    fn restore_draft(&mut self, channel: &str) {
        self.raw = false;
        self.attachments.clear();
        self.draft = from_markdown(
            self.drafts
                .iter()
                .find(|d| d.pane_id == COMPOSER && d.channel_id == channel)
                .map_or("", |d| d.text.as_str()),
        );
    }

    pub(crate) fn markdown(&self) -> String {
        if self.raw {
            self.source.text.clone()
        } else {
            to_markdown(&self.draft)
        }
    }

    pub(crate) fn clear_draft(&mut self) {
        self.raw = false;
        self.attachments.clear();
        self.draft = from_markdown("");
    }

    pub(crate) fn attach(&mut self, paths: &[std::path::PathBuf]) {
        for path in paths {
            if path.is_file() && !self.attachments.contains(path) {
                self.attachments.push(path.clone());
            }
        }
    }

    pub(crate) fn quote_reply(&mut self, post: &antimatter_services::mattermost::Post) {
        let quote: String = post.message.lines().map(|l| format!("> {l}\n")).collect();
        let rest = self.markdown();
        let md = format!("{quote}\n{rest}");
        if self.raw {
            self.source = TextEdit::new(md);
        } else {
            self.draft = from_markdown(&md);
        }
    }

    pub(crate) fn toggle_raw(&mut self) {
        if self.raw {
            self.draft = from_markdown(&self.source.text);
        } else {
            self.source = TextEdit::new(to_markdown(&self.draft));
        }
        self.raw = !self.raw;
    }

    pub(crate) fn load_now(&mut self, channel: String) {
        if self.dispatch(Intent::Load(channel.clone())) {
            self.note_open(&channel);
            self.channel = Some(channel.clone());
            self.navigation.channel_id = Some(channel.clone());
            self.restore_draft(&channel);
            self.posts.clear();
            self.members.clear();
            self.ready = false;
            self.loading_older = false;
            self.dispatch(Intent::Members(channel));
        }
    }

    pub(crate) fn load_older(&mut self) {
        if !self.ready
            || self.busy
            || self.submitted
            || self.recovered_pending
            || self.pending.is_some()
            || !self.has_older
            || self.synthetic
        {
            return;
        }
        if self.dispatch(Intent::Older) {
            self.ready = false;
            self.loading_older = true;
        }
    }

    pub(crate) fn send(&mut self) {
        if !self.ready
            || self.busy
            || self.submitted
            || self.recovered_pending
            || self.pending.is_some()
            || self.channel.is_none()
            || (self.markdown().trim().is_empty() && self.attachments.is_empty())
        {
            return;
        }
        self.checkpoint(AfterCheckpoint::Send(self.markdown()));
    }

    pub(crate) fn apply(&mut self, update: Update) {
        match update {
            Update::Navigation {
                site_name,
                channels,
                unread,
                ..
            } => {
                self.site_name = site_name;
                self.channels = channels;
                self.unread = unread;
                self.prune_tabs();
            }
            Update::Unread(unread) => {
                let arrived: Vec<String> = unread
                    .iter()
                    .filter(|(id, count)| {
                        count.messages > self.unread.get(*id).map_or(0, |u| u.messages)
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in arrived {
                    if let Some(at) = self.navigation.archived.iter().position(|a| *a == id) {
                        self.navigation.archived.remove(at);
                    }
                }
                self.unread = unread;
            }
            Update::Presence(presence) => self.presence = presence,
            Update::PeerPresence(presence) => self.peer_presence.extend(presence),
            Update::PeerAvatar(user_id, bytes) => self.avatars.finish(user_id, bytes),
            Update::Members {
                channel_id,
                user_ids,
            } => {
                if self.channel.as_deref() == Some(&channel_id) {
                    self.members = user_ids;
                }
            }
            Update::Timeline {
                channel_id,
                posts,
                names,
                has_older,
            } => {
                if self.channel.as_deref() == Some(&channel_id) {
                    let mut authors: Vec<String> =
                        posts.iter().map(|p| p.user_id.clone()).collect();
                    authors.sort();
                    authors.dedup();
                    self.posts = posts;
                    self.has_older = has_older;
                    self.names.extend(names);
                    if let Some(sender) = &self.intents {
                        let _ = sender.try_send(Intent::Presence(authors));
                    }
                }
            }
            Update::Older {
                channel_id,
                posts,
                names,
                has_older,
            } => {
                if self.channel.as_deref() == Some(&channel_id) {
                    self.has_older = has_older;
                    self.loading_older = false;
                    self.names.extend(names);
                    for post in posts {
                        if !self.posts.iter().any(|p| p.id == post.id) {
                            self.posts.push(post);
                        }
                    }
                    self.posts
                        .sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
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
                        self.clear_draft();
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
                self.loading_older = false;
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
