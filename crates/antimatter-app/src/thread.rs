use crate::markdown::{from_markdown, to_markdown};
use crate::state::*;
use antimatter_services::{conversation::Intent, mattermost::Post};

pub(crate) fn root_of(post: &Post) -> String {
    if post.root_id.is_empty() {
        post.id.clone()
    } else {
        post.root_id.clone()
    }
}

fn in_thread(post: &Post, root: &str) -> bool {
    post.id == root || post.root_id == root
}

impl State {
    pub(crate) fn open_thread_pane(&mut self, post: &Post) {
        let root = root_of(post);
        if self.thread.as_ref().is_some_and(|t| t.root_id == root) {
            return;
        }
        if self.channel.as_deref() != Some(post.channel_id.as_str()) {
            return;
        }
        if !self.synthetic && !self.dispatch(Intent::Thread(root.clone())) {
            return;
        }
        let posts = self
            .posts
            .iter()
            .filter(|p| in_thread(p, &root))
            .cloned()
            .collect();
        self.thread_draft = from_markdown("");
        self.thread_attachments.clear();
        self.thread = Some(ThreadPane {
            root_id: root,
            channel_id: post.channel_id.clone(),
            posts,
        });
    }

    pub(crate) fn close_thread_pane(&mut self) {
        self.thread = None;
        self.thread_draft = from_markdown("");
        self.thread_attachments.clear();
    }

    pub(crate) fn thread_markdown(&self) -> String {
        to_markdown(&self.thread_draft)
    }

    pub(crate) fn attach_thread(&mut self, paths: &[std::path::PathBuf]) {
        for path in paths {
            if path.is_file() && !self.thread_attachments.contains(path) {
                self.thread_attachments.push(path.clone());
            }
        }
    }

    pub(crate) fn send_thread(&mut self) {
        let Some(root) = self.thread.as_ref().map(|t| t.root_id.clone()) else {
            return;
        };
        let message = self.thread_markdown();
        if !self.ready
            || self.busy
            || self.submitted
            || self.recovered_pending
            || self.pending.is_some()
            || self.channel.is_none()
            || (message.trim().is_empty() && self.thread_attachments.is_empty())
        {
            return;
        }
        let attached = self.thread_attachments.is_empty()
            || self.dispatch(Intent::Attach(self.thread_attachments.clone()));
        if attached && self.dispatch(Intent::Reply(root.clone(), message)) {
            self.replying = Some(root);
            self.submitted = true;
            self.ready = false;
        }
    }

    pub(crate) fn finish_thread_reply(&mut self) {
        self.replying = None;
        self.submitted = false;
        self.thread_draft = from_markdown("");
        self.thread_attachments.clear();
        self.thread_draft.focused = true;
    }

    pub(crate) fn apply_thread_posts(
        &mut self,
        root_id: String,
        channel_id: String,
        posts: Vec<Post>,
    ) {
        if self.channel.as_deref() != Some(channel_id.as_str()) {
            return;
        }
        if let Some(thread) = self
            .thread
            .as_mut()
            .filter(|t| t.root_id == root_id && t.channel_id == channel_id)
        {
            thread.posts = posts;
        }
    }

    pub(crate) fn thread_upsert(&mut self, post: &Post) {
        if let Some(thread) = self
            .thread
            .as_mut()
            .filter(|t| t.channel_id == post.channel_id && in_thread(post, &t.root_id))
        {
            thread.posts.retain(|p| p.id != post.id);
            thread.posts.push(post.clone());
            thread
                .posts
                .sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
        }
    }

    pub(crate) fn thread_remove(&mut self, channel_id: &str, post_id: &str) {
        if let Some(thread) = self.thread.as_mut().filter(|t| t.channel_id == channel_id) {
            thread.posts.retain(|p| p.id != post_id);
        }
    }
}
