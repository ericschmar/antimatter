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

pub enum Intent {
    Load(String),
    Send(String),
    Retry,
    Refresh,
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
        teams: Vec<Team>,
        channels: Vec<Channel>,
        unread: HashMap<String, Unread>,
    },
    Unread(HashMap<String, Unread>),
    Timeline {
        channel_id: String,
        posts: Vec<Post>,
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
        previous: None,
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
                Some(Event::Refresh) => worker.refresh().await,
                Some(Event::State(state)) => {
                    if !matches!(state, State::Connected | State::Error(crate::websocket::Failure::MalformedFrame)) {
                        worker.emit(Update::Ready(false)).await;
                    }
                    worker.emit(Update::Connection(state)).await;
                    if state == State::Connected { worker.refresh().await } else { Ok(()) }
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
    previous: Option<String>,
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
        let standalone = matches!(intent, Intent::Send(_) | Intent::Retry);
        let result = async {
            match intent {
                Intent::Load(channel) => {
                    if channel.trim().is_empty() {
                        return Err(Failure::InvalidInput);
                    }
                    self.previous = self.channel.replace(channel.clone());
                    self.posts.clear();
                    self.emit(Update::Timeline {
                        channel_id: channel,
                        posts: vec![],
                    })
                    .await;
                    self.refresh().await
                }
                Intent::Refresh => self.refresh().await,
                Intent::Send(message) => {
                    if self.pending.is_some() || message.trim().is_empty() {
                        return Err(Failure::InvalidInput);
                    }
                    let channel_id = self.channel.clone().ok_or(Failure::InvalidInput)?;
                    self.pending = Some(Pending {
                        post: CreatePost {
                            channel_id,
                            message,
                            pending_post_id: uuid::Uuid::new_v4().to_string(),
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

    async fn refresh(&mut self) -> Result<(), Failure> {
        self.emit(Update::Ready(false)).await;
        let teams = self.client.teams().await.map_err(|_| Failure::Load)?;
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
        self.emit(Update::Navigation {
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
            let mut posts: Vec<_> = self
                .posts
                .values()
                .filter(|p| p.delete_at == 0)
                .cloned()
                .collect();
            posts.sort_by(|a, b| (a.create_at, &a.id).cmp(&(b.create_at, &b.id)));
            self.emit(Update::Timeline {
                channel_id: channel.clone(),
                posts,
            })
            .await;
            self.view(&channel).await;
        }
        self.emit(Update::Ready(true)).await;
        Ok(())
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

    async fn wire(&mut self, event: WireEvent) -> Result<(), Failure> {
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
            if event.event == "posted" {
                self.count(&post, &event).await;
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
mod tests {
    use super::*;
    use crate::mattermost::{Secret, ServerOrigin};
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn post(id: &str, pending: &str) -> Post {
        Post {
            id: id.into(),
            channel_id: "c".into(),
            user_id: "u".into(),
            message: "keep text".into(),
            create_at: 100,
            update_at: 100,
            delete_at: 0,
            pending_post_id: pending.into(),
        }
    }

    async fn fixture() -> (Client, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin =
            ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
        let task = tokio::spawn(async move {
            let mut requests = vec![];
            let mut pending = String::new();
            // Load (6), lost send (1), retry across two pages (2), reconnect refresh (6).
            for step in 0..15 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut buffer = [0; 4096];
                    let n = socket.read(&mut buffer).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(bytes).unwrap();
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains("authorization: bearer fake")
                );
                let path = request.split_whitespace().nth(1).unwrap().to_owned();
                requests.push(request.clone());
                if step == 6 {
                    let body: Value =
                        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                    pending = body["pending_post_id"].as_str().unwrap().to_owned();
                    assert!(uuid::Uuid::parse_str(&pending).is_ok());
                    assert_eq!(body["message"], "keep text");
                    drop(socket); // Server committed, HTTP reply was lost.
                    continue;
                }
                let body = if path.ends_with("/users/me/teams") {
                    json!([{"id":"t","name":"team"}])
                } else if path.contains("/teams/t/channels?") {
                    assert!(path.contains("per_page=200"));
                    json!([{"id":"c","team_id":"t","name":"channel","type":"O"}])
                } else if path.ends_with("/users/me/channels/c/unread") {
                    json!({"team_id":"t","channel_id":"c","msg_count":0,"mention_count":0})
                } else if path.ends_with("/members/u/view") {
                    json!({"status":"OK"})
                } else if path.ends_with("/channels/c") {
                    json!({"id":"c","team_id":"t","name":"channel","type":"O"})
                } else {
                    assert!(path.contains("per_page=60"));
                    if step == 7 {
                        json!({"order":["new"],"posts":{"new":post("new", "")},"prev_post_id":"older"})
                    } else if step == 8 {
                        assert!(path.contains("before=new"));
                        json!({"order":["sent"],"posts":{"sent":post("sent", &pending)},"prev_post_id":""})
                    } else {
                        json!({"order":[],"posts":{},"prev_post_id":""})
                    }
                }.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
            requests
        });
        (
            Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap(),
            task,
        )
    }

    async fn next(updates: &mut mpsc::Receiver<Update>) -> Update {
        tokio::time::timeout(Duration::from_secs(3), updates.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn lost_response_retry_reconnect_and_untrusted_events() {
        let (client, server) = fixture().await;
        let (intents, rx) = mpsc::channel(16);
        let (ws, events) = mpsc::channel(16);
        let (tx, mut updates) = mpsc::channel(32);
        let worker = tokio::spawn(run(client, "u".into(), rx, events, tx));
        intents.send(Intent::Load("c".into())).await.unwrap();
        loop {
            match next(&mut updates).await {
                Update::Navigation {
                    teams, channels, ..
                } => {
                    assert_eq!(teams[0].id, "t");
                    assert_eq!(channels[0].id, "c");
                }
                Update::Ready(true) => break,
                Update::Failed(f) => panic!("unexpected {f:?}"),
                _ => {}
            }
        }
        intents
            .send(Intent::Send("keep text".into()))
            .await
            .unwrap();
        let pending = loop {
            if let Update::Pending(Some(p)) = next(&mut updates).await
                && p.failed
            {
                break p;
            }
        };
        assert_eq!(pending.post.message, "keep text");
        assert!(!pending.retryable);
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Failed(Failure::Send)
        ));
        let mut bad = post("spoof", &pending.post.pending_post_id);
        bad.channel_id = "other".into();
        ws.send(Event::Wire(WireEvent {
            event: "posted".into(),
            data: json!({"post":bad}),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(matches!(
            next(&mut updates).await,
            Update::Failed(Failure::InvalidInput)
        ));
        bad.channel_id = "c".into();
        bad.user_id = "impostor".into();
        ws.send(Event::Wire(WireEvent {
            event: "posted".into(),
            data: json!({"post":bad}),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(matches!(
            next(&mut updates).await,
            Update::Failed(Failure::Reconcile)
        ));
        ws.send(Event::Wire(WireEvent {
            event: "posted".into(),
            data: json!({"post":"not JSON"}),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(matches!(
            next(&mut updates).await,
            Update::Failed(Failure::InvalidInput)
        ));
        intents.send(Intent::Retry).await.unwrap();
        assert!(matches!(next(&mut updates).await, Update::Pending(None)));
        let sent = match next(&mut updates).await {
            Update::Upsert(p) => p,
            _ => panic!("missing send"),
        };
        assert_eq!(sent.pending_post_id, pending.post.pending_post_id);
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        // HTTP/WS duplicate is silent; then nested string edit and object deletion.
        ws.send(Event::Wire(WireEvent {
            event: "posted".into(),
            data: json!({"post":sent}),
            broadcast: json!({"channel_id":"c"}),
            seq: None,
        }))
        .await
        .unwrap();
        let mut edited = sent.clone();
        edited.message = "edit".into();
        edited.update_at = 101;
        ws.send(Event::Wire(WireEvent {
            event: "post_edited".into(),
            data: json!({"post":serde_json::to_string(&edited).unwrap()})
                .to_string()
                .into(),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(matches!(next(&mut updates).await, Update::Upsert(p) if p.message == "edit"));
        edited.delete_at = 102;
        ws.send(Event::Wire(WireEvent {
            event: "post_deleted".into(),
            data: json!({"post":edited}),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(
            matches!(next(&mut updates).await, Update::Deleted { post_id, .. } if post_id == "sent")
        );
        ws.send(Event::Wire(WireEvent {
            event: "posted".into(),
            data: json!({"post":post("deleted-while-offline", "")}),
            broadcast: json!({}),
            seq: None,
        }))
        .await
        .unwrap();
        assert!(matches!(next(&mut updates).await, Update::Upsert(_)));
        ws.send(Event::State(State::Disconnected)).await.unwrap();
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Connection(State::Disconnected)
        ));
        ws.send(Event::State(State::Connected)).await.unwrap();
        assert!(matches!(
            next(&mut updates).await,
            Update::Connection(State::Connected)
        ));
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Navigation { .. }
        ));
        assert!(
            matches!(next(&mut updates).await, Update::Timeline { posts, .. } if posts.is_empty())
        );
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        let requests = server.await.unwrap();
        assert_eq!(
            requests
                .iter()
                .filter(|r| r.starts_with("POST /api/v4/posts "))
                .count(),
            1
        );
        drop(intents);
        worker.await.unwrap();
    }

    async fn scripted(
        responses: Vec<Option<(u16, Value)>>,
    ) -> (
        Worker,
        mpsc::Receiver<Update>,
        tokio::task::JoinHandle<Vec<String>>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin =
            ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut buffer = [0; 4096];
                    let n = socket.read(&mut buffer).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let length = String::from_utf8_lossy(&bytes[..end])
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                if let Some((status, body)) = response {
                    let body = body.to_string();
                    socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                }
            }
            assert!(
                tokio::time::timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err()
            );
            requests
        });
        let (updates, rx) = mpsc::channel(64);
        (
            Worker {
                client: Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap(),
                user_id: "u".into(),
                updates,
                channel: Some("c".into()),
                posts: HashMap::new(),
                identities: HashMap::new(),
                unread: HashMap::new(),
                previous: None,
                pending: Some(Pending {
                    post: CreatePost {
                        channel_id: "c".into(),
                        message: "keep text".into(),
                        pending_post_id: "pending".into(),
                    },
                    failed: false,
                    retryable: false,
                }),
            },
            rx,
            server,
        )
    }

    #[tokio::test]
    async fn initial_refresh_before_socket_auth_is_unblocked_by_connected() {
        let (worker, _, server) = scripted(vec![
            Some((200, json!([]))),
            Some((200, json!([]))),
            Some((200, json!([]))),
        ])
        .await;
        let (intents, rx) = mpsc::channel(16);
        let (ws, events) = mpsc::channel(16);
        let (tx, mut updates) = mpsc::channel(32);
        let task = tokio::spawn(run(worker.client, "u".into(), rx, events, tx));
        intents.send(Intent::Refresh).await.unwrap();
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Navigation { .. }
        ));
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        for state in [State::Idle, State::Connecting] {
            ws.send(Event::State(state)).await.unwrap();
            assert!(matches!(next(&mut updates).await, Update::Ready(false)));
            assert!(matches!(next(&mut updates).await, Update::Connection(s) if s == state));
        }
        ws.send(Event::State(State::Connected)).await.unwrap();
        assert!(matches!(
            next(&mut updates).await,
            Update::Connection(State::Connected)
        ));
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Navigation { .. }
        ));
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        ws.send(Event::Refresh).await.unwrap();
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Navigation { .. }
        ));
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        for state in [
            State::Error(crate::websocket::Failure::MalformedFrame),
            State::Error(crate::websocket::Failure::Transport),
            State::Error(crate::websocket::Failure::AuthenticationRejected),
            State::Error(crate::websocket::Failure::AuthenticationTimeout),
            State::Error(crate::websocket::Failure::HeartbeatTimeout),
            State::Error(crate::websocket::Failure::SequenceExhausted),
            State::Disconnected,
        ] {
            ws.send(Event::State(state)).await.unwrap();
            if state != State::Error(crate::websocket::Failure::MalformedFrame) {
                assert!(matches!(next(&mut updates).await, Update::Ready(false)));
            }
            assert!(matches!(next(&mut updates).await, Update::Connection(s) if s == state));
            assert!(updates.try_recv().is_err());
        }
        drop(intents);
        task.await.unwrap();
        assert_eq!(server.await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn standalone_send_failure_completes_before_ready() {
        let (mut worker, mut updates, server) = scripted(vec![Some((400, json!({})))]).await;
        worker.pending = None;
        assert_eq!(
            worker.intent(Intent::Send("keep text".into())).await,
            Err(Failure::Send)
        );
        assert!(matches!(next(&mut updates).await, Update::Pending(Some(p)) if !p.failed));
        assert!(matches!(next(&mut updates).await, Update::Pending(Some(p)) if p.failed));
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        assert!(updates.try_recv().is_err());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn refresh_acknowledgement_is_not_ready_until_timeline() {
        let (mut worker, mut updates, server) = scripted(vec![
            Some((200, json!([]))),
            Some((
                200,
                json!({"id":"c","team_id":"t","name":"channel","type":"O"}),
            )),
            Some((
                200,
                json!({"order":["sent"],"posts":{"sent":post("sent", "pending")}}),
            )),
            Some((200, json!({"status":"OK"}))),
        ])
        .await;
        worker.refresh().await.unwrap();
        assert!(matches!(next(&mut updates).await, Update::Ready(false)));
        assert!(matches!(
            next(&mut updates).await,
            Update::Navigation { .. }
        ));
        assert!(matches!(next(&mut updates).await, Update::Pending(None)));
        assert!(
            matches!(next(&mut updates).await, Update::Timeline { posts, .. } if posts.len() == 1)
        );
        assert!(matches!(next(&mut updates).await, Update::Ready(true)));
        assert!(updates.try_recv().is_err());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn stripped_history_and_delayed_commit_never_resend_ambiguous_writes() {
        for rejection in [
            None,
            Some((200, json!("bad post"))),
            Some((408, json!({}))),
            Some((500, json!({}))),
            Some((503, json!({}))),
        ] {
            let empty = json!({"order":[],"posts":{},"prev_post_id":""});
            let history = json!({"order":["committed"],"posts":{"committed":post("committed", "")},"prev_post_id":""});
            let (mut worker, mut rx, server) = scripted(vec![
                rejection,
                Some((200, empty.clone())),
                Some((200, history)),
                Some((200, empty)),
            ])
            .await;
            assert_eq!(worker.send().await, Err(Failure::Send));
            assert!(
                worker
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.failed && !p.retryable)
            );
            while rx.try_recv().is_ok() {}
            assert_eq!(worker.intent(Intent::Retry).await, Err(Failure::Reconcile));
            assert!(matches!(rx.try_recv(), Ok(Update::Ready(true))));
            assert!(rx.try_recv().is_err());
            // Commit becomes visible only after the first absence scan, without the transient ID.
            assert_eq!(worker.intent(Intent::Retry).await, Err(Failure::Reconcile));
            assert!(
                worker
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.failed && !p.retryable)
            );
            while let Ok(update) = rx.try_recv() {
                assert!(!matches!(update, Update::Pending(None)));
            }
            worker
                .wire(WireEvent {
                    event: "posted".into(),
                    data: json!({"post":post("committed", "pending")}),
                    broadcast: json!({}),
                    seq: None,
                })
                .await
                .unwrap();
            assert!(worker.pending.is_none());
            assert!(matches!(rx.try_recv(), Ok(Update::Pending(None))));
            let requests = server.await.unwrap();
            assert_eq!(
                requests.iter().filter(|r| r.starts_with("POST ")).count(),
                1
            );
        }
    }

    #[tokio::test]
    async fn definitive_client_rejection_allows_explicit_same_body_retry() {
        for status in [400, 401, 403, 404, 409, 429] {
            let (mut worker, mut rx, server) = scripted(vec![
                Some((status, json!({}))),
                Some((200, json!({"order":[],"posts":{},"prev_post_id":""}))),
                Some((200, json!(post("sent", "pending")))),
            ])
            .await;
            assert_eq!(worker.send().await, Err(Failure::Send));
            assert!(
                worker
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.failed && p.retryable)
            );
            while rx.try_recv().is_ok() {}
            worker.intent(Intent::Retry).await.unwrap();
            assert!(
                matches!(rx.try_recv(), Ok(Update::Pending(Some(p))) if !p.failed && !p.retryable)
            );
            assert!(worker.pending.is_none());
            assert!(matches!(rx.try_recv(), Ok(Update::Pending(None))));
            assert!(matches!(rx.try_recv(), Ok(Update::Upsert(_))));
            assert!(matches!(rx.try_recv(), Ok(Update::Ready(true))));
            assert!(rx.try_recv().is_err());
            let requests = server.await.unwrap();
            let bodies: Vec<_> = requests
                .iter()
                .filter(|r| r.starts_with("POST "))
                .map(|r| r.split("\r\n\r\n").nth(1).unwrap())
                .collect();
            assert_eq!(bodies.len(), 2);
            assert_eq!(bodies[0], bodies[1]);
        }
    }

    #[test]
    fn unordered_parent_extras_are_validated() {
        let mut page: PostPage = serde_json::from_value(json!({
            "order":["reply"], "posts":{"reply":post("reply", ""),"parent":post("parent", "")}
        }))
        .unwrap();
        let posts = page_posts(&page, "c").unwrap();
        assert_eq!(posts.len(), 2);
        assert_eq!(posts[0].id, "reply");
        page.posts.get_mut("parent").unwrap().channel_id = "other".into();
        assert_eq!(page_posts(&page, "c"), Err(Failure::Reconcile));
        page.posts.get_mut("parent").unwrap().channel_id = "c".into();
        page.posts.get_mut("parent").unwrap().id = "mismatched".into();
        assert_eq!(page_posts(&page, "c"), Err(Failure::Reconcile));
        page.posts.insert("parent".into(), post("parent", ""));
        page.order.push("reply".into());
        assert_eq!(page_posts(&page, "c"), Err(Failure::Reconcile));
        page.order = vec!["missing".into()];
        assert_eq!(page_posts(&page, "c"), Err(Failure::Reconcile));
    }

    #[tokio::test]
    async fn reconcile_allows_repeated_unordered_parents_and_acknowledges_extra() {
        let (mut worker, _, server) = scripted(vec![
            Some((200, json!({"order":["new"],"posts":{"new":post("new", ""),"parent":post("parent", "")}}))),
            Some((200, json!({"order":["old"],"posts":{"old":post("old", ""),"parent":post("parent", "pending")}}))),
        ]).await;
        worker.pending.as_mut().unwrap().failed = true;
        worker.intent(Intent::Retry).await.unwrap();
        assert!(worker.pending.is_none());
        let requests = server.await.unwrap();
        assert!(requests[1].contains("before=new"));
        assert!(requests.iter().all(|r| r.starts_with("GET ")));
    }

    #[tokio::test]
    async fn refresh_replaces_offline_snapshot_and_rejects_invalid_extras_atomically() {
        let mut impostor = post("spoof", "pending");
        impostor.user_id = "other".into();
        let navigation = vec![
            Some((200, json!([{"id":"t","name":"team"}]))),
            Some((
                200,
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}]),
            )),
            Some((
                200,
                json!({"channel_id":"c","msg_count":0,"mention_count":0}),
            )),
            Some((
                200,
                json!({"id":"c","team_id":"t","name":"channel","type":"O"}),
            )),
        ];
        let mut responses = navigation.clone();
        responses.push(Some((200, json!({"order":["reply"],"posts":{"reply":post("reply", ""),"parent":post("parent", "")}}))));
        responses.push(Some((200, json!({"status":"OK"}))));
        responses.extend(navigation);
        responses.push(Some((
            200,
            json!({"order":["new"],"posts":{"new":post("new", ""),"spoof":impostor}}),
        )));
        let (mut worker, mut rx, server) = scripted(responses).await;
        worker
            .posts
            .insert("offline-deletion".into(), post("offline-deletion", ""));
        worker.refresh().await.unwrap();
        assert_eq!(worker.posts.len(), 2);
        assert!(!worker.posts.contains_key("offline-deletion"));
        assert!(worker.posts.contains_key("parent"));
        while let Ok(update) = rx.try_recv() {
            if let Update::Timeline { posts, .. } = update {
                assert_eq!(posts.len(), 2);
                assert!(posts.iter().all(|p| p.id != "offline-deletion"));
            }
        }
        let snapshot = worker.posts.clone();
        let identities = worker.identities.clone();
        assert_eq!(worker.refresh().await, Err(Failure::Reconcile));
        assert_eq!(worker.posts, snapshot);
        assert_eq!(worker.identities, identities);
        assert!(worker.pending.is_some());
        while let Ok(update) = rx.try_recv() {
            assert!(!matches!(
                update,
                Update::Timeline { .. } | Update::Pending(None) | Update::Ready(true)
            ));
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn unread_counts_are_server_backed_cleared_by_view_and_advisory_on_failure() {
        let (mut worker, mut rx, server) = scripted(vec![
            Some((200, json!([{"id":"t","name":"team"}]))),
            Some((
                200,
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}]),
            )),
            Some((
                200,
                json!({"channel_id":"c","msg_count":3,"mention_count":1}),
            )),
            Some((
                200,
                json!({"id":"c","team_id":"t","name":"channel","type":"O"}),
            )),
            Some((200, json!({"order":[],"posts":{},"prev_post_id":""}))),
            Some((200, json!({"status":"OK"}))),
            Some((200, json!([{"id":"t","name":"team"}]))),
            Some((
                200,
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}]),
            )),
            Some((500, json!({}))),
            Some((
                200,
                json!({"id":"c","team_id":"t","name":"channel","type":"O"}),
            )),
            Some((200, json!({"order":[],"posts":{},"prev_post_id":""}))),
            Some((500, json!({}))),
        ])
        .await;
        worker.pending = None;
        worker.previous = Some("old".into());
        worker.refresh().await.unwrap();
        let mut seen = vec![];
        while let Ok(update) = rx.try_recv() {
            match update {
                Update::Navigation { unread, .. } => seen.push(unread["c"]),
                Update::Unread(unread) => seen.push(unread["c"]),
                _ => {}
            }
        }
        assert_eq!(
            seen,
            [
                Unread {
                    messages: 3,
                    mentions: 1
                },
                Unread::default()
            ]
        );
        worker.unread.insert(
            "c".into(),
            Unread {
                messages: 2,
                mentions: 0,
            },
        );
        worker.refresh().await.unwrap();
        assert_eq!(
            worker.unread["c"],
            Unread {
                messages: 2,
                mentions: 0
            }
        );
        let requests = server.await.unwrap();
        assert!(requests[2].starts_with("GET /api/v4/users/me/channels/c/unread "));
        assert!(requests[5].starts_with("POST /api/v4/channels/members/u/view "));
        assert!(requests[5].contains(r#""prev_channel_id":"old""#));
    }

    #[tokio::test]
    async fn unread_deltas_ignore_own_current_and_spoofed_events() {
        let (mut worker, mut rx, server) = scripted(vec![]).await;
        worker.pending = None;
        worker.unread.insert("d".into(), Unread::default());
        let posted = |channel: &str, user: &str, mentions: &str| WireEvent {
            event: "posted".into(),
            data: json!({"mentions": mentions, "post": {"id":"p","channel_id":channel,"user_id":user,"message":"m","create_at":1}}),
            broadcast: json!({}),
            seq: None,
        };
        worker.wire(posted("d", "u", "")).await.unwrap();
        worker.wire(posted("unknown", "x", "")).await.unwrap();
        assert!(rx.try_recv().is_err());
        worker.wire(posted("d", "x", r#"["u"]"#)).await.unwrap();
        assert!(
            matches!(rx.try_recv(), Ok(Update::Unread(u)) if u["d"] == Unread { messages: 1, mentions: 1 })
        );
        let viewed = |data| WireEvent {
            event: "channel_viewed".into(),
            data,
            broadcast: json!({}),
            seq: None,
        };
        assert_eq!(
            worker.wire(viewed(json!({}))).await,
            Err(Failure::InvalidInput)
        );
        worker
            .wire(viewed(json!({"channel_id":"d"})))
            .await
            .unwrap();
        assert!(matches!(rx.try_recv(), Ok(Update::Unread(u)) if u["d"] == Unread::default()));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn retry_fails_closed_on_missing_terminal_proof() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin =
            ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 2048];
            assert!(socket.read(&mut buffer).await.unwrap() > 0);
            let body = r#"{"order":[],"posts":{}}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            drop(socket);
            assert!(
                tokio::time::timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err()
            );
        });
        let (updates, mut rx) = mpsc::channel(4);
        let pending = Pending {
            post: CreatePost {
                channel_id: "c".into(),
                message: "keep text".into(),
                pending_post_id: uuid::Uuid::new_v4().to_string(),
            },
            failed: true,
            retryable: false,
        };
        let mut worker = Worker {
            client: Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap(),
            user_id: "u".into(),
            updates,
            channel: Some("c".into()),
            posts: HashMap::new(),
            identities: HashMap::new(),
            unread: HashMap::new(),
            previous: None,
            pending: Some(pending.clone()),
        };
        assert_eq!(worker.intent(Intent::Retry).await, Err(Failure::Reconcile));
        assert_eq!(
            worker.pending.unwrap().post.pending_post_id,
            pending.post.pending_post_id
        );
        assert!(matches!(rx.try_recv(), Ok(Update::Ready(true))));
        assert!(rx.try_recv().is_err());
        server.await.unwrap();
    }
}
