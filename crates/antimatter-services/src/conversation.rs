use crate::{
    mattermost::{Channel, Client, CreatePost, Post, PostPage, Team},
    websocket::{Event, State, WireEvent},
};
use futures_util::{StreamExt, stream};
use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Unread {
    pub messages: u64,
    pub mentions: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThreadPreview {
    pub id: String,
    pub team_id: String,
    pub channel_id: String,
    pub root_message: String,
    pub unread_replies: u64,
    pub unread_mentions: u64,
    pub reply_id: String,
    pub reply_user_id: String,
    pub reply_message: String,
}

pub enum Intent {
    Load(String),
    Older,
    Members(String),
    Presence(Vec<String>),
    Send(String),
    Edit(String, String),
    Attach(Vec<std::path::PathBuf>),
    Root(String),
    Retry,
    Refresh,
    Threads,
    Active,
}

#[derive(Clone)]
pub struct Pending {
    pub post: CreatePost,
    pub failed: bool,
    pub retryable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Load,
    Send,
    Reconcile,
    InvalidInput,
}

pub enum Update {
    Navigation {
        site_name: String,
        teams: Vec<Team>,
        channels: Vec<Channel>,
        unread: HashMap<String, Unread>,
    },
    Presence(String),
    PeerPresence(HashMap<String, String>),
    PeerAvatar(String, Option<Vec<u8>>),
    Unread(HashMap<String, Unread>),
    Notification {
        channel_id: String,
        sender: String,
        message: String,
    },
    Threads {
        threads: Vec<ThreadPreview>,
        names: HashMap<String, String>,
    },
    Timeline {
        channel_id: String,
        posts: Vec<Post>,
        names: HashMap<String, String>,
        has_older: bool,
    },
    Older {
        channel_id: String,
        posts: Vec<Post>,
        names: HashMap<String, String>,
        has_older: bool,
    },
    Members {
        channel_id: String,
        user_ids: Vec<String>,
        names: HashMap<String, String>,
    },
    Upsert(Post),
    Deleted {
        channel_id: String,
        post_id: String,
    },
    Pending(Option<Pending>),
    Ready(bool),
    Connection(State),
    Failed(Failure),
}

pub async fn run(
    client: Client,
    user_id: String,
    mut intents: mpsc::Receiver<Intent>,
    mut socket: mpsc::Receiver<Event>,
    updates: mpsc::Sender<Update>,
) {
    if user_id.trim().is_empty() {
        let _ = updates.send(Update::Failed(Failure::InvalidInput)).await;
        return;
    }
    let mut worker = Worker {
        client,
        user_id,
        updates,
        channel: None,
        posts: HashMap::new(),
        identities: HashMap::new(),
        pending: None,
        unread: HashMap::new(),
        team_ids: Vec::new(),
        live_threads: HashMap::new(),
        names: HashMap::new(),
        site_name: String::new(),
        presence: String::new(),
        avatars: HashSet::new(),
        previous: None,
        has_older: false,
        older: HashSet::new(),
        uploads: Vec::new(),
        root: String::new(),
    };
    // ponytail: intents serialize behind HTTP; the session owner cancels this whole worker
    // and blocks channel switches while unready/pending; use pane generations for supersession.
    loop {
        let result = tokio::select! {
            intent = intents.recv() => match intent {
                Some(intent) => worker.intent(intent).await,
                None => break,
            },
            event = socket.recv(), if !socket.is_closed() || !socket.is_empty() => match event {
                Some(Event::Refresh) => {
                    let result = worker.refresh().await;
                    worker.all_threads().await;
                    result
                }
                Some(Event::State(state)) => {
                    if !matches!(state, State::Connected | State::Error(crate::websocket::Failure::MalformedFrame)) {
                        worker.emit(Update::Ready(false)).await;
                    }
                    worker.emit(Update::Connection(state)).await;
                    if state == State::Connected {
                        let result = worker.refresh().await;
                        worker.all_threads().await;
                        result
                    } else {
                        Ok(())
                    }
                }
                Some(Event::Wire(event)) => worker.wire(event).await,
                None => Ok(()),
            },
        };
        if let Err(failure) = result {
            worker.emit(Update::Failed(failure)).await;
        }
        if worker.updates.is_closed() {
            break;
        }
    }
}

struct Worker {
    client: Client,
    user_id: String,
    updates: mpsc::Sender<Update>,
    channel: Option<String>,
    posts: HashMap<String, Post>,
    identities: HashMap<(String, String, String), String>,
    pending: Option<Pending>,
    unread: HashMap<String, Unread>,
    team_ids: Vec<String>,
    live_threads: HashMap<String, ThreadPreview>,
    names: HashMap<String, String>,
    site_name: String,
    presence: String,
    avatars: HashSet<String>,
    previous: Option<String>,
    has_older: bool,
    older: HashSet<String>,
    uploads: Vec<std::path::PathBuf>,
    root: String,
}

fn post_user_ids(posts: &[Post]) -> Vec<String> {
    let mut ids = Vec::new();
    for post in posts {
        ids.push(post.user_id.clone());
        for reaction in &post.metadata.reactions {
            ids.push(reaction.user_id.clone());
        }
    }
    ids
}

fn direct_peer(name: &str, user_id: &str) -> Option<String> {
    name.split("__")
        .find(|id| *id != user_id && !id.is_empty())
        .map(str::to_owned)
}

fn direct_avatar_peer(name: &str, user_id: &str) -> String {
    direct_peer(name, user_id).unwrap_or_else(|| user_id.to_owned())
}

fn page_posts(page: &PostPage, channel: &str) -> Result<Vec<Post>, Failure> {
    let mut ids = HashSet::new();
    for id in &page.order {
        if !ids.insert(id) || !page.posts.contains_key(id) {
            return Err(Failure::Reconcile);
        }
    }
    for (id, post) in &page.posts {
        if post.id != *id
            || post.id.is_empty()
            || post.channel_id != channel
            || post.user_id.is_empty()
            || post.create_at <= 0
        {
            return Err(Failure::Reconcile);
        }
    }
    Ok(page
        .order
        .iter()
        .map(|id| page.posts[id].clone())
        .chain(
            page.posts
                .iter()
                .filter(|(id, _)| !ids.contains(id))
                .map(|(_, post)| post.clone()),
        )
        .collect())
}

impl Worker {
    async fn emit(&self, update: Update) {
        let _ = self.updates.send(update).await;
    }

    async fn intent(&mut self, intent: Intent) -> Result<(), Failure> {
        let standalone = matches!(intent, Intent::Send(_) | Intent::Retry | Intent::Older);
        let result = async {
            match intent {
                Intent::Load(channel) => {
                    if channel.trim().is_empty() {
                        return Err(Failure::InvalidInput);
                    }
                    let before = self.live_threads.len();
                    self.live_threads.retain(|_, t| t.channel_id != channel);
                    let dropped = self.live_threads.len() != before;
                    self.previous = self.channel.replace(channel.clone());
                    self.posts.clear();
                    self.has_older = false;
                    self.older.clear();
                    if dropped {
                        self.all_threads().await;
                    }
                    self.refresh().await
                }
                Intent::Older => self.older().await,
                Intent::Refresh => self.refresh().await,
                Intent::Active => {
                    if let Some(channel) = self.channel.clone() {
                        let _ = self.client.view_channel(&self.user_id, &channel, "").await;
                    }
                    Ok(())
                }
                Intent::Threads => {
                    self.all_threads().await;
                    Ok(())
                }
                Intent::Members(channel) => {
                    if channel.trim().is_empty() {
                        return Err(Failure::InvalidInput);
                    }
                    self.members(&channel).await;
                    Ok(())
                }
                Intent::Presence(ids) => {
                    let ids: Vec<_> = ids.into_iter().filter(|id| !id.is_empty()).collect();
                    if !ids.is_empty()
                        && let Ok(statuses) = self.client.statuses(&ids).await
                    {
                        let statuses: HashMap<_, _> = statuses.into_iter().collect();
                        self.emit(Update::PeerPresence(statuses)).await;
                    }
                    for id in ids {
                        if self.avatars.insert(id.clone()) {
                            let bytes = self.client.custom_profile_image(&id).await.ok();
                            self.emit(Update::PeerAvatar(id, bytes)).await;
                        }
                    }
                    Ok(())
                }
                Intent::Attach(paths) => {
                    self.uploads = paths;
                    Ok(())
                }
                Intent::Edit(post_id, message) => {
                    if self.pending.is_some() || message.trim().is_empty() || post_id.is_empty() {
                        return Err(Failure::InvalidInput);
                    }
                    let reply = self
                        .client
                        .patch_post(&post_id, &serde_json::json!({ "message": message }))
                        .await
                        .map_err(|_| Failure::Send)?;
                    let post: Post = serde_json::from_value(reply).map_err(|_| Failure::Reconcile)?;
                    if post.id != post_id {
                        return Err(Failure::Reconcile);
                    }
                    self.accept(post, true).await
                }
                Intent::Root(root) => {
                    self.root = root;
                    Ok(())
                }
                Intent::Send(message) => {
                    if self.pending.is_some()
                        || (message.trim().is_empty() && self.uploads.is_empty())
                    {
                        return Err(Failure::InvalidInput);
                    }
                    let channel_id = self.channel.clone().ok_or(Failure::InvalidInput)?;
                    self.pending = Some(Pending {
                        post: CreatePost {
                            channel_id,
                            message,
                            pending_post_id: uuid::Uuid::new_v4().to_string(),
                            file_ids: Vec::new(),
                            root_id: std::mem::take(&mut self.root),
                        },
                        failed: false,
                        retryable: false,
                    });
                    self.send().await
                }
                Intent::Retry => {
                    let pending = self.pending.clone().ok_or(Failure::InvalidInput)?;
                    if !pending.failed {
                        return Err(Failure::InvalidInput);
                    }
                    self.reconcile(&pending).await?;
                    if self.pending.is_some() {
                        if !pending.retryable {
                            return Err(Failure::Reconcile);
                        }
                        self.send().await?;
                    }
                    Ok(())
                }
            }
        }
        .await;
        if standalone {
            self.emit(Update::Ready(true)).await;
        }
        result
    }

    async fn resolve_names(&mut self, ids: impl IntoIterator<Item = String>) {
        let mut missing: Vec<_> = ids
            .into_iter()
            .filter(|id| !id.is_empty() && !self.names.contains_key(id))
            .collect();
        missing.sort();
        missing.dedup();
        if missing.is_empty() {
            return;
        }
        let Ok(users) = self.client.users_by_ids(&missing).await else {
            return;
        };
        for user in users {
            if missing.contains(&user.id) {
                self.names.insert(user.id.clone(), user.display_name());
            }
        }
    }

    async fn name_direct_channels(&mut self, channels: &mut [Channel]) {
        let peers: Vec<_> = channels
            .iter()
            .filter(|c| c.kind == "D")
            .filter_map(|c| direct_peer(&c.name, &self.user_id))
            .collect();
        self.resolve_names(peers).await;
        let mut group_members = Vec::new();
        for channel in channels.iter().filter(|c| c.kind == "G") {
            let ids: Vec<String> = match self.client.channel_members(&channel.id, 0).await {
                Ok(members) => members
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m.get("user_id")?.as_str().map(str::to_owned))
                    .filter(|id| *id != self.user_id)
                    .collect(),
                Err(_) => Vec::new(),
            };
            group_members.push((channel.id.clone(), ids));
        }
        self.resolve_names(group_members.iter().flat_map(|(_, ids)| ids.clone()))
            .await;
        for (id, ids) in group_members {
            if ids.is_empty() {
                continue;
            }
            let Some(channel) = channels.iter_mut().find(|c| c.id == id) else {
                continue;
            };
            let mut names: Vec<String> = ids
                .iter()
                .map(|id| self.names.get(id).cloned().unwrap_or_else(|| id.clone()))
                .collect();
            names.sort_by_key(|n| n.to_lowercase());
            channel.display_name = names.join(", ");
            channel.members = ids;
        }
        for channel in channels.iter_mut().filter(|c| c.kind == "D") {
            let Some(peer) = direct_peer(&channel.name, &self.user_id) else {
                channel.display_name = "You".into();
                continue;
            };
            channel.display_name = self.names.get(&peer).cloned().unwrap_or(peer);
        }
    }

    async fn refresh(&mut self) -> Result<(), Failure> {
        self.emit(Update::Ready(false)).await;
        let teams = self.client.teams().await.map_err(|_| Failure::Load)?;
        if self.site_name.is_empty() {
            self.site_name = self.client.site_name().await.unwrap_or_default();
        }
        let presence = self.client.status(&self.user_id).await.unwrap_or_default();
        if !presence.is_empty() && presence != self.presence {
            self.presence = presence.clone();
            self.emit(Update::Presence(presence)).await;
        }
        let mut channels = Vec::new();
        let mut seen = HashSet::new();
        for team in &teams {
            if team.id.is_empty() {
                return Err(Failure::Load);
            }
            // ponytail: navigation caps at 10,000 pages; fail closed, use a server cursor if exceeded.
            let mut complete = false;
            for page in 0..10_000 {
                let batch = self
                    .client
                    .channels(&team.id, page)
                    .await
                    .map_err(|_| Failure::Load)?;
                let last = batch.len() < 200;
                for channel in batch {
                    if channel.id.is_empty()
                        || (!channel.team_id.is_empty() && channel.team_id != team.id)
                    {
                        return Err(Failure::Load);
                    }
                    if seen.insert(channel.id.clone()) {
                        channels.push(channel);
                    }
                }
                if last {
                    complete = true;
                    break;
                }
            }
            if !complete {
                return Err(Failure::Load);
            }
        }
        self.name_direct_channels(&mut channels).await;
        let mut peers: Vec<_> = channels
            .iter()
            .filter(|c| c.kind == "D")
            .map(|c| direct_avatar_peer(&c.name, &self.user_id))
            .collect();
        for channel in channels.iter().filter(|c| c.kind == "G") {
            peers.extend(channel.members.iter().take(3).cloned());
        }
        peers.sort();
        peers.dedup();
        if !peers.is_empty()
            && let Ok(statuses) = self.client.statuses(&peers).await
        {
            let statuses: HashMap<_, _> = statuses.into_iter().collect();
            self.emit(Update::PeerPresence(statuses)).await;
        }
        for peer in peers {
            if self.avatars.insert(peer.clone()) {
                let bytes = self.client.custom_profile_image(&peer).await.ok();
                self.emit(Update::PeerAvatar(peer, bytes)).await;
            }
        }
        let ids: Vec<_> = channels.iter().map(|c| c.id.clone()).collect();
        let client = &self.client;
        let fetched: Vec<_> = stream::iter(ids)
            .map(|id| async move {
                let unread = client.channel_unread(&id).await;
                (id, unread)
            })
            .buffered(8)
            .collect()
            .await;
        let mut unread = HashMap::new();
        for (id, result) in fetched {
            // Advisory counts: a failed or mismatched lookup keeps the last known value.
            let known = match result {
                Ok(u) if u.channel_id == id => Some(Unread {
                    messages: u.msg_count,
                    mentions: u.mention_count,
                }),
                _ => self.unread.get(&id).copied(),
            };
            if let Some(known) = known {
                unread.insert(id, known);
            }
        }
        self.unread = unread.clone();
        self.team_ids = teams.iter().map(|t| t.id.clone()).collect();
        self.emit(Update::Navigation {
            site_name: self.site_name.clone(),
            teams,
            channels,
            unread,
        })
        .await;
        if let Some(channel) = self.channel.clone() {
            let detail = self
                .client
                .channel(&channel)
                .await
                .map_err(|_| Failure::Load)?;
            if detail.id != channel {
                return Err(Failure::Load);
            }
            let page = self
                .client
                .posts(&channel, None)
                .await
                .map_err(|_| Failure::Load)?;
            let posts = page_posts(&page, &channel).map_err(|_| Failure::Load)?;
            let latest_has_older = page
                .prev_post_id
                .as_deref()
                .is_some_and(|id| !id.is_empty());
            let old_posts = std::mem::take(&mut self.posts);
            let old_identities = self.identities.clone();
            let pending = self.pending.take();
            for post in &posts {
                let invalid_ack = pending.as_ref().is_some_and(|pending| {
                    post.pending_post_id == pending.post.pending_post_id
                        && (post.channel_id != pending.post.channel_id
                            || post.user_id != self.user_id)
                });
                if invalid_ack || self.accept(post.clone(), false).await.is_err() {
                    self.posts = old_posts;
                    self.identities = old_identities;
                    self.pending = pending;
                    return Err(Failure::Reconcile);
                }
            }
            self.pending = pending;
            for post in posts {
                self.accept(post, false).await?;
            }
            let mut restored = Vec::new();
            for (id, post) in old_posts {
                if self.older.contains(&id)
                    && !self.posts.contains_key(&id)
                    && post.channel_id == channel
                {
                    restored.push(id.clone());
                    self.posts.insert(id, post);
                }
            }
            self.older = restored.into_iter().collect();
            self.has_older = self.has_older || latest_has_older;
            let mut posts: Vec<_> = self
                .posts
                .values()
                .filter(|p| p.delete_at == 0)
                .cloned()
                .collect();
            posts.sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
            self.resolve_names(post_user_ids(&posts)).await;
            let names = self.names.clone();
            self.emit(Update::Timeline {
                channel_id: channel.clone(),
                posts,
                names,
                has_older: self.has_older,
            })
            .await;
            self.view(&channel).await;
        }
        self.emit(Update::Ready(true)).await;
        Ok(())
    }

    // One older page before the oldest loaded post; a refresh keeps paged-back history.
    async fn older(&mut self) -> Result<(), Failure> {
        let channel = self.channel.clone().ok_or(Failure::InvalidInput)?;
        if !self.has_older {
            return Ok(());
        }
        let before = self
            .posts
            .values()
            .min_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)))
            .map(|p| p.id.clone())
            .ok_or(Failure::InvalidInput)?;
        let page = self
            .client
            .posts(&channel, Some(&before))
            .await
            .map_err(|_| Failure::Load)?;
        let posts = page_posts(&page, &channel).map_err(|_| Failure::Load)?;
        let has_older = page
            .prev_post_id
            .as_deref()
            .is_some_and(|id| !id.is_empty());
        let mut fresh = Vec::new();
        for post in posts {
            if !self.posts.contains_key(&post.id) {
                fresh.push(post.clone());
            }
            self.older.insert(post.id.clone());
            self.accept(post, false).await?;
        }
        self.has_older = has_older;
        let mut posts: Vec<_> = fresh.into_iter().filter(|p| p.delete_at == 0).collect();
        posts.sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
        self.resolve_names(post_user_ids(&posts)).await;
        let names = self.names.clone();
        self.emit(Update::Older {
            channel_id: channel,
            posts,
            names,
            has_older,
        })
        .await;
        Ok(())
    }

    // Best effort: a failed member lookup leaves the header without a stack.
    async fn members(&mut self, channel: &str) {
        let Ok(members) = self.client.channel_members(channel, 0).await else {
            return;
        };
        let ids: Vec<String> = members
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|member| member.get("user_id")?.as_str().map(str::to_owned))
            .collect();
        self.resolve_names(ids.iter().cloned()).await;
        let shown: Vec<_> = ids.iter().take(5).cloned().collect();
        if !shown.is_empty()
            && let Ok(statuses) = self.client.statuses(&shown).await
        {
            let statuses: HashMap<_, _> = statuses.into_iter().collect();
            self.emit(Update::PeerPresence(statuses)).await;
        }
        for peer in shown {
            if self.avatars.insert(peer.clone()) {
                let bytes = self.client.custom_profile_image(&peer).await.ok();
                self.emit(Update::PeerAvatar(peer, bytes)).await;
            }
        }
        let names = self.names.clone();
        self.emit(Update::Members {
            channel_id: channel.to_owned(),
            user_ids: ids,
            names,
        })
        .await;
    }

    // Best effort and idempotent: failure leaves the server counts for the next refresh.
    async fn view(&mut self, channel: &str) {
        let previous = self.previous.take().unwrap_or_default();
        if self
            .client
            .view_channel(&self.user_id, channel, &previous)
            .await
            .is_ok()
            && self
                .unread
                .get(channel)
                .is_some_and(|u| *u != Unread::default())
        {
            self.unread.insert(channel.into(), Unread::default());
            self.emit(Update::Unread(self.unread.clone())).await;
        }
    }

    async fn send(&mut self) -> Result<(), Failure> {
        let body = self
            .pending
            .as_ref()
            .ok_or(Failure::InvalidInput)?
            .post
            .clone();
        if let Some(pending) = &mut self.pending {
            pending.failed = false;
            pending.retryable = false;
        }
        self.emit(Update::Pending(self.pending.clone())).await;
        let mut body = body;
        if !self.uploads.is_empty() {
            match self.upload().await {
                Ok(ids) => {
                    body.file_ids = ids;
                    if let Some(pending) = &mut self.pending {
                        pending.post.file_ids = body.file_ids.clone();
                    }
                    self.uploads.clear();
                }
                Err(()) => {
                    if let Some(pending) = &mut self.pending {
                        pending.failed = true;
                        pending.retryable = true;
                    }
                    self.emit(Update::Pending(self.pending.clone())).await;
                    return Err(Failure::Send);
                }
            }
        }
        let result = self.client.create_post(&body).await;
        let retryable = result
            .as_ref()
            .err()
            .and_then(|error| error.status())
            .is_some_and(|status| (400..500).contains(&status) && status != 408);
        if let Ok(post) = result
            && post.channel_id == body.channel_id
            && post.user_id == self.user_id
            && post.pending_post_id == body.pending_post_id
            && !post.id.is_empty()
            && post.create_at > 0
            && self.accept(post, true).await.is_ok()
        {
            return Ok(());
        }
        if let Some(pending) = &mut self.pending {
            pending.failed = true;
            pending.retryable = retryable;
        }
        self.emit(Update::Pending(self.pending.clone())).await;
        Err(Failure::Send)
    }

    async fn upload(&self) -> Result<Vec<String>, ()> {
        let channel = self.channel.as_deref().ok_or(())?;
        let mut ids = Vec::new();
        for path in &self.uploads {
            let name = path
                .file_name()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
            let bytes = std::fs::read(path).map_err(|_| ())?;
            let reply = self
                .client
                .upload_file(channel, &name, bytes)
                .await
                .map_err(|_| ())?;
            let id = reply["file_infos"][0]["id"].as_str().ok_or(())?;
            ids.push(id.to_owned());
        }
        Ok(ids)
    }

    async fn reconcile(&mut self, pending: &Pending) -> Result<(), Failure> {
        let mut before: Option<String> = None;
        let mut seen = HashSet::new();
        // ponytail: scan all history, not a local-clock cutoff (server clock may skew).
        // Cap at 10,000 pages and fail closed; upgrade to a server snapshot/cursor for huge channels.
        for _ in 0..10_000 {
            let page = self
                .client
                .posts(&pending.post.channel_id, before.as_deref())
                .await
                .map_err(|_| Failure::Reconcile)?;
            let posts = page_posts(&page, &pending.post.channel_id)?;
            for id in &page.order {
                if !seen.insert(id.clone()) {
                    return Err(Failure::Reconcile);
                }
            }
            for post in &posts {
                if post.pending_post_id == pending.post.pending_post_id {
                    if post.user_id != self.user_id {
                        return Err(Failure::Reconcile);
                    }
                    self.accept(post.clone(), true).await?;
                    return Ok(());
                }
            }
            if page.order.is_empty() {
                return if page.prev_post_id.as_deref() == Some("") && page.has_next != Some(true) {
                    // ponytail: GET strips pending IDs and the bounded server cache cannot prove
                    // non-commit; ambiguous writes stay blocked until an identity acknowledgement.
                    if pending.retryable {
                        Ok(())
                    } else {
                        Err(Failure::Reconcile)
                    }
                } else {
                    Err(Failure::Reconcile)
                };
            }
            before = page.order.last().cloned();
        }
        Err(Failure::Reconcile)
    }

    async fn accept(&mut self, post: Post, publish: bool) -> Result<(), Failure> {
        if post.id.is_empty()
            || post.channel_id.is_empty()
            || post.user_id.is_empty()
            || post.create_at <= 0
        {
            return Err(Failure::InvalidInput);
        }
        let acknowledges = self
            .pending
            .as_ref()
            .is_some_and(|pending| post.pending_post_id == pending.post.pending_post_id);
        if acknowledges {
            let pending = self.pending.as_ref().unwrap();
            if post.channel_id != pending.post.channel_id || post.user_id != self.user_id {
                return Err(Failure::Reconcile);
            }
        }
        if let Some(old) = self.posts.get(&post.id)
            && (old.channel_id != post.channel_id
                || old.user_id != post.user_id
                || (!old.pending_post_id.is_empty()
                    && !post.pending_post_id.is_empty()
                    && old.pending_post_id != post.pending_post_id))
        {
            return Err(Failure::Reconcile);
        }
        if !post.pending_post_id.is_empty() {
            let key = (
                post.channel_id.clone(),
                post.user_id.clone(),
                post.pending_post_id.clone(),
            );
            if let Some(id) = self.identities.get(&key) {
                if id != &post.id {
                    return Err(Failure::Reconcile);
                }
            } else {
                self.identities.insert(key, post.id.clone());
            }
        }
        if acknowledges {
            self.pending = None;
            self.emit(Update::Pending(None)).await;
        }
        if self.channel.as_deref() != Some(&post.channel_id) {
            return Ok(());
        }
        if let Some(old) = self.posts.get(&post.id)
            && (old == &post || old.update_at > post.update_at || old.delete_at > post.delete_at)
        {
            return Ok(());
        }
        self.posts.insert(post.id.clone(), post.clone());
        if publish {
            if post.delete_at != 0 {
                self.emit(Update::Deleted {
                    channel_id: post.channel_id,
                    post_id: post.id,
                })
                .await;
            } else {
                self.emit(Update::Upsert(post)).await;
            }
        }
        Ok(())
    }

    async fn viewed(&mut self, event: &WireEvent) -> Result<(), Failure> {
        let id = event
            .data
            .get("channel_id")
            .and_then(|v| v.as_str())
            .filter(|id| !id.is_empty())
            .ok_or(Failure::InvalidInput)?;
        if self.unread.get(id).is_some_and(|u| *u != Unread::default()) {
            self.unread.insert(id.into(), Unread::default());
            self.emit(Update::Unread(self.unread.clone())).await;
        }
        if self.live_threads.values().any(|t| t.channel_id == id) {
            self.live_threads.retain(|_, t| t.channel_id != id);
            self.all_threads().await;
        }
        Ok(())
    }

    async fn status(&mut self, event: &WireEvent) -> Result<(), Failure> {
        if event.data.get("user_id").and_then(|v| v.as_str()) != Some(self.user_id.as_str()) {
            return Ok(());
        }
        let presence = event
            .data
            .get("status")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or(Failure::InvalidInput)?;
        if presence != self.presence {
            self.presence = presence.to_owned();
            self.emit(Update::Presence(self.presence.clone())).await;
        }
        Ok(())
    }

    // Advisory delta; the next refresh replaces it with server counts.
    async fn count(&mut self, post: &Post, event: &WireEvent) {
        if post.user_id == self.user_id {
            return;
        }
        let Some(unread) = self.unread.get_mut(&post.channel_id) else {
            return;
        };
        unread.messages += 1;
        let mentioned = event
            .data
            .get("mentions")
            .and_then(|v| v.as_str())
            .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            .is_some_and(|ids| ids.contains(&self.user_id));
        unread.mentions += u64::from(mentioned);
        self.emit(Update::Unread(self.unread.clone())).await;
    }

    // Advisory: a failed lookup (collapsed threads off, offline) keeps the last known list.
    async fn threads(&mut self, team_ids: &[String]) {
        let mut found = Vec::new();
        for team_id in team_ids {
            let Ok(page) = self.client.threads(&self.user_id, team_id).await else {
                return;
            };
            for thread in page.threads {
                if thread.unread_replies == 0 && thread.unread_mentions == 0 {
                    continue;
                }
                if self.live_threads.contains_key(&thread.id) {
                    continue;
                }
                let Some(reply) = self.latest_reply(&thread.id).await else {
                    continue;
                };
                found.push(ThreadPreview {
                    id: thread.id,
                    team_id: team_id.clone(),
                    channel_id: thread.post.channel_id,
                    root_message: thread.post.message,
                    unread_replies: thread.unread_replies,
                    unread_mentions: thread.unread_mentions,
                    reply_id: reply.id,
                    reply_user_id: reply.user_id,
                    reply_message: reply.message,
                });
            }
        }
        found.extend(self.live_threads.values().cloned());
        self.resolve_names(found.iter().map(|t| t.reply_user_id.clone()))
            .await;
        let names = self.names.clone();
        self.emit(Update::Threads {
            threads: found,
            names,
        })
        .await;
    }

    async fn all_threads(&mut self) {
        let ids = self.team_ids.clone();
        if !ids.is_empty() {
            self.threads(&ids).await;
        }
    }

    async fn latest_reply(&self, root: &str) -> Option<Post> {
        let page: PostPage = serde_json::from_value(self.client.thread(root).await.ok()?).ok()?;
        page.posts
            .into_values()
            .filter(|p| p.root_id == root && p.delete_at == 0)
            .max_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)))
    }

    // A reply in a channel that is not open is an unread thread preview, whoever wrote it:
    // the server's unread list leaves out the user's own replies (for example from the web app).
    async fn track_reply(&mut self, post: &Post, mentioned: bool) -> bool {
        if post.root_id.is_empty()
            || post.delete_at != 0
            || self.channel.as_deref() == Some(&post.channel_id)
        {
            return false;
        }
        let known = self.live_threads.get(&post.root_id).cloned();
        let (root_message, team_id) = match &known {
            Some(t) => (t.root_message.clone(), t.team_id.clone()),
            None => {
                let Some(root) = self.root_post(&post.root_id).await else {
                    return false;
                };
                let team_id = match self.client.channel(&post.channel_id).await {
                    Ok(c) if !c.team_id.is_empty() => c.team_id,
                    _ => self.team_ids.first().cloned().unwrap_or_default(),
                };
                (root.message, team_id)
            }
        };
        let (replies, mentions) = known.map_or((0, 0), |t| (t.unread_replies, t.unread_mentions));
        self.live_threads.insert(
            post.root_id.clone(),
            ThreadPreview {
                id: post.root_id.clone(),
                team_id,
                channel_id: post.channel_id.clone(),
                root_message,
                unread_replies: replies + 1,
                unread_mentions: mentions + u64::from(mentioned),
                reply_id: post.id.clone(),
                reply_user_id: post.user_id.clone(),
                reply_message: post.message.clone(),
            },
        );
        true
    }

    async fn root_post(&self, root: &str) -> Option<Post> {
        let page: PostPage = serde_json::from_value(self.client.thread(root).await.ok()?).ok()?;
        page.posts
            .into_iter()
            .find(|(id, _)| id == root)
            .map(|(_, p)| p)
    }

    async fn wire(&mut self, event: WireEvent) -> Result<(), Failure> {
        let mut threads = match event.event.as_str() {
            "thread_updated" | "thread_read_changed" | "thread_follow_changed" => true,
            "posted" => event
                .nested::<Post>("post")
                .is_ok_and(|p| !p.root_id.is_empty() && p.user_id != self.user_id),
            _ => false,
        };
        if event.event == "posted"
            && let Ok(post) = event.nested::<Post>("post")
        {
            let mentioned = post.user_id != self.user_id
                && event
                    .data
                    .get("mentions")
                    .and_then(|v| v.as_str())
                    .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
                    .is_some_and(|ids| ids.contains(&self.user_id));
            threads |= self.track_reply(&post, mentioned).await;
        }
        if event.event == "thread_read_changed"
            && let Some(id) = event.data.get("thread_id").and_then(|v| v.as_str())
        {
            self.live_threads.remove(id);
        }
        let result = self.dispatch_wire(event).await;
        if threads {
            self.all_threads().await;
        }
        result
    }

    async fn dispatch_wire(&mut self, event: WireEvent) -> Result<(), Failure> {
        if event.event == "status_change" {
            return self.status(&event).await;
        }
        if event.event == "channel_viewed" {
            return self.viewed(&event).await;
        }
        if !matches!(
            event.event.as_str(),
            "posted" | "post_edited" | "post_deleted"
        ) {
            return Ok(());
        }
        let post: Post = event.nested("post").map_err(|_| Failure::InvalidInput)?;
        if let Some(channel) = event.broadcast.get("channel_id").and_then(|v| v.as_str())
            && channel != post.channel_id
        {
            return Err(Failure::InvalidInput);
        }
        if self.channel.as_deref() != Some(&post.channel_id) {
            // Never allow a cross-channel event to acknowledge the current pending identity.
            if self
                .pending
                .as_ref()
                .is_some_and(|p| p.post.pending_post_id == post.pending_post_id)
            {
                return Err(Failure::InvalidInput);
            }
            if event.event == "posted" && self.unread.contains_key(&post.channel_id) {
                self.count(&post, &event).await;
                if post.user_id != self.user_id {
                    self.resolve_names([post.user_id.clone()]).await;
                    let sender = self.names.get(&post.user_id).cloned().unwrap_or_default();
                    self.emit(Update::Notification {
                        channel_id: post.channel_id.clone(),
                        sender,
                        message: post.message.clone(),
                    })
                    .await;
                }
            }
            return Ok(());
        }
        if event.event == "post_deleted" && post.delete_at == 0 {
            return Err(Failure::InvalidInput);
        }
        self.accept(post, true).await
    }
}

#[cfg(test)]
mod tests;
