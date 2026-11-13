use super::*;
use crate::mattermost::{Secret, ServerOrigin};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use wiremock::{Match, Mock, MockServer, Request, ResponseTemplate};

fn path_contains(pattern: &'static str) -> impl Match {
    move |request: &Request| {
        let target = match request.url.query() {
            Some(query) => format!("{}?{query}", request.url.path()),
            None => request.url.path().to_owned(),
        };
        target.contains(pattern)
    }
}

#[test]
fn direct_channels_are_named_from_the_other_participant() {
    assert_eq!(direct_peer("me__them", "me").as_deref(), Some("them"));
    assert_eq!(direct_peer("them__me", "me").as_deref(), Some("them"));
    assert_eq!(direct_peer("me__me", "me"), None);
    assert_eq!(direct_avatar_peer("me__me", "me"), "me");
    assert_eq!(direct_avatar_peer("me__them", "me"), "them");
}

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
        metadata: Default::default(),
    }
}

async fn fixture() -> (Client, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin =
        ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
    let task = tokio::spawn(async move {
        let mut requests = vec![];
        let mut pending = String::new();
        // Load (8), lost send (1), retry across two pages (2), reconnect refresh (6).
        for step in 0..17 {
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
            if step == 8 {
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
            } else if path.ends_with("/config/client?format=old") {
                json!({"SiteName":"Test"})
            } else if path.ends_with("/users/u/status") {
                json!({"user_id":"u","status":"online"})
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
                if step == 9 {
                    json!({"order":["new"],"posts":{"new":post("new", "")},"prev_post_id":"older"})
                } else if step == 10 {
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
    assert!(matches!(next(&mut updates).await, Update::Timeline { posts, .. } if posts.is_empty()));
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

fn worker(origin: ServerOrigin, pending: Option<Pending>) -> (Worker, mpsc::Receiver<Update>) {
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
            names: HashMap::new(),
            site_name: String::new(),
            presence: String::new(),
            avatars: HashSet::new(),
            previous: None,
            has_older: false,
            older: HashSet::new(),
            pending,
        },
        rx,
    )
}

struct Recorder(MockServer);

impl Recorder {
    async fn finish(self) -> Vec<String> {
        self.0
            .received_requests()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|request| {
                let query = request
                    .url
                    .query()
                    .map(|q| format!("?{q}"))
                    .unwrap_or_default();
                let auth = request
                    .headers
                    .get("authorization")
                    .map(|v| format!("\r\nauthorization: {}", v.to_str().unwrap_or_default()))
                    .unwrap_or_default();
                format!(
                    "{} {}{query} HTTP/1.1{auth}\r\n\r\n{}",
                    request.method,
                    request.url.path(),
                    String::from_utf8_lossy(&request.body)
                )
            })
            .collect()
    }
}

async fn routed(
    routes: Vec<(&'static str, Option<(u16, Value)>)>,
) -> (Worker, mpsc::Receiver<Update>, Recorder) {
    let server = MockServer::start().await;
    for (index, (pattern, reply)) in routes.into_iter().enumerate() {
        let response = match reply {
            Some((status, body)) => ResponseTemplate::new(status).set_body_json(body),
            None => ResponseTemplate::new(200),
        };
        Mock::given(path_contains(pattern))
            .respond_with(response)
            .with_priority(index as u8 + 1)
            .mount(&server)
            .await;
    }
    let origin = ServerOrigin::new(&server.uri(), true).unwrap();
    let (worker, rx) = worker(origin, None);
    (worker, rx, Recorder(server))
}

async fn scripted_raw(
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
    let pending = Pending {
        post: CreatePost {
            channel_id: "c".into(),
            message: "keep text".into(),
            pending_post_id: "pending".into(),
        },
        failed: false,
        retryable: false,
    };
    let (worker, rx) = worker(origin, Some(pending));
    (worker, rx, server)
}

async fn scripted(
    responses: Vec<Option<(u16, Value)>>,
) -> (Worker, mpsc::Receiver<Update>, Recorder) {
    let server = MockServer::start().await;
    for (index, reply) in responses.into_iter().enumerate() {
        let response = match reply {
            Some((status, body)) => ResponseTemplate::new(status).set_body_json(body),
            None => ResponseTemplate::new(200),
        };
        Mock::given(wiremock::matchers::any())
            .respond_with(response)
            .with_priority(index as u8 + 1)
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    let origin = ServerOrigin::new(&server.uri(), true).unwrap();
    let pending = Pending {
        post: CreatePost {
            channel_id: "c".into(),
            message: "keep text".into(),
            pending_post_id: "pending".into(),
        },
        failed: false,
        retryable: false,
    };
    let (worker, rx) = worker(origin, Some(pending));
    (worker, rx, Recorder(server))
}

#[tokio::test]
async fn initial_refresh_before_socket_auth_is_unblocked_by_connected() {
    let (worker, _, server) = routed(vec![
        ("/users/me/teams", Some((200, json!([])))),
        (
            "/config/client?format=old",
            Some((200, json!({"SiteName":"Test"}))),
        ),
        (
            "/users/u/status",
            Some((200, json!({"user_id":"u","status":"online"}))),
        ),
        ("/teams/t/channels?", Some((200, json!([])))),
    ])
    .await;
    let (intents, rx) = mpsc::channel(16);
    let (ws, events) = mpsc::channel(16);
    let (tx, mut updates) = mpsc::channel(32);
    let task = tokio::spawn(run(worker.client, "u".into(), rx, events, tx));
    intents.send(Intent::Refresh).await.unwrap();
    assert!(matches!(next(&mut updates).await, Update::Ready(false)));
    assert!(matches!(next(&mut updates).await, Update::Presence(p) if p == "online"));
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
    assert_eq!(server.finish().await.len(), 7);
}

#[tokio::test]
async fn standalone_send_failure_completes_before_ready() {
    let (mut worker, mut updates, server) = routed(vec![("/posts", Some((400, json!({}))))]).await;
    worker.pending = None;
    assert_eq!(
        worker.intent(Intent::Send("keep text".into())).await,
        Err(Failure::Send)
    );
    assert!(matches!(next(&mut updates).await, Update::Pending(Some(p)) if !p.failed));
    assert!(matches!(next(&mut updates).await, Update::Pending(Some(p)) if p.failed));
    assert!(matches!(next(&mut updates).await, Update::Ready(true)));
    assert!(updates.try_recv().is_err());
    server.finish().await;
}

#[tokio::test]
async fn refresh_acknowledgement_is_not_ready_until_timeline() {
    let (mut worker, mut updates, server) = routed(vec![
        ("/users/me/teams", Some((200, json!([])))),
        (
            "/config/client?format=old",
            Some((200, json!({"SiteName":"Test"}))),
        ),
        (
            "/users/u/status",
            Some((200, json!({"user_id":"u","status":"online"}))),
        ),
        (
            "/teams/t/channels?",
            Some((
                200,
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}]),
            )),
        ),
        (
            "/channels/c/posts?",
            Some((
                200,
                json!({"order":["sent"],"posts":{"sent":post("sent", "pending")}}),
            )),
        ),
        (
            "/users/me/channels/c/unread",
            Some((
                200,
                json!({"channel_id":"c","msg_count":0,"mention_count":0}),
            )),
        ),
        (
            "/channels/c",
            Some((
                200,
                json!({"id":"c","team_id":"t","name":"channel","type":"O"}),
            )),
        ),
        (
            "/users/ids",
            Some((200, json!([{"id":"u","username":"user"}]))),
        ),
        (
            "/channels/members/u/view",
            Some((200, json!({"status":"OK"}))),
        ),
    ])
    .await;
    worker.pending = Some(Pending {
        post: CreatePost {
            channel_id: "c".into(),
            message: "keep text".into(),
            pending_post_id: "pending".into(),
        },
        failed: false,
        retryable: false,
    });
    worker.refresh().await.unwrap();
    assert!(matches!(next(&mut updates).await, Update::Ready(false)));
    assert!(matches!(next(&mut updates).await, Update::Presence(p) if p == "online"));
    assert!(matches!(
        next(&mut updates).await,
        Update::Navigation { .. }
    ));
    assert!(matches!(next(&mut updates).await, Update::Pending(None)));
    assert!(matches!(next(&mut updates).await, Update::Timeline { posts, .. } if posts.len() == 1));
    assert!(matches!(next(&mut updates).await, Update::Ready(true)));
    assert!(updates.try_recv().is_err());
    server.finish().await;
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
        let (mut worker, mut rx, server) = scripted_raw(vec![
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
        assert!(matches!(rx.try_recv(), Ok(Update::Pending(Some(p))) if !p.failed && !p.retryable));
        assert!(worker.pending.is_none());
        assert!(matches!(rx.try_recv(), Ok(Update::Pending(None))));
        assert!(matches!(rx.try_recv(), Ok(Update::Upsert(_))));
        assert!(matches!(rx.try_recv(), Ok(Update::Ready(true))));
        assert!(rx.try_recv().is_err());
        let requests = server.finish().await;
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
    let requests = server.finish().await;
    assert!(requests[1].contains("before=new"));
    assert!(requests.iter().all(|r| r.starts_with("GET ")));
}

#[tokio::test]
async fn refresh_replaces_offline_snapshot_and_rejects_invalid_extras_atomically() {
    let mut impostor = post("spoof", "pending");
    impostor.user_id = "other".into();
    let navigation = [
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
    let mut responses = vec![
        Some((200, json!([{"id":"t","name":"team"}]))),
        Some((200, json!({"SiteName":"Test"}))),
        Some((200, json!({"user_id":"u","status":"online"}))),
    ];
    responses.extend(navigation[1..].iter().cloned());
    responses.push(Some((
        200,
        json!({"order":["reply"],"posts":{"reply":post("reply", ""),"parent":post("parent", "")}}),
    )));
    responses.push(Some((200, json!([{"id":"u","username":"user"}]))));
    responses.push(Some((200, json!({"status":"OK"}))));
    responses.extend(navigation[..1].iter().cloned());
    responses.push(Some((200, json!({"user_id":"u","status":"online"}))));
    responses.extend(navigation[1..].iter().cloned());
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
    server.finish().await;
}

#[tokio::test]
async fn unread_counts_are_server_backed_cleared_by_view_and_advisory_on_failure() {
    let (mut worker, mut rx, server) = scripted(vec![
        Some((200, json!([{"id":"t","name":"team"}]))),
        Some((200, json!({"SiteName":"Test"}))),
        Some((200, json!({"user_id":"u","status":"online"}))),
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
        Some((200, json!({"user_id":"u","status":"online"}))),
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
    let requests = server.finish().await;
    assert!(requests[1].starts_with("GET /api/v4/config/client?format=old "));
    assert!(requests[4].starts_with("GET /api/v4/users/me/channels/c/unread "));
    assert!(requests[7].starts_with("POST /api/v4/channels/members/u/view "));
    assert!(requests[7].contains(r#""prev_channel_id":"old""#));
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
    server.finish().await;
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
        names: HashMap::new(),
        site_name: String::new(),
        presence: String::new(),
        avatars: HashSet::new(),
        previous: None,
        has_older: false,
        older: HashSet::new(),
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

#[tokio::test]
async fn older_page_requests_the_cursor_and_clears_at_history_start() {
    let mut newest = post("newest", "");
    newest.create_at = 300;
    let mut middle = post("middle", "");
    middle.create_at = 200;
    let mut oldest = post("oldest", "");
    oldest.create_at = 100;
    let (mut worker, mut rx, server) = scripted(vec![
        Some((
            200,
            json!({"order":["middle"],"posts":{"middle":middle.clone()},"prev_post_id":"oldest"}),
        )),
        Some((200, json!([{"id":"u","username":"user"}]))),
        Some((
            200,
            json!({"order":["oldest"],"posts":{"oldest":oldest.clone()},"prev_post_id":""}),
        )),
        Some((200, json!([{"id":"u","username":"user"}]))),
    ])
    .await;
    worker.pending = None;
    worker.channel = Some("c".into());
    worker.has_older = true;
    worker.posts.insert(newest.id.clone(), newest.clone());
    worker.intent(Intent::Older).await.unwrap();
    assert!(worker.has_older);
    worker.intent(Intent::Older).await.unwrap();
    assert!(!worker.has_older);
    assert!(worker.posts.contains_key("oldest") && worker.posts.contains_key("middle"));
    let mut seen = vec![];
    while let Ok(update) = rx.try_recv() {
        if let Update::Older {
            posts, has_older, ..
        } = update
        {
            seen.push((posts.len(), has_older));
        }
    }
    assert_eq!(seen, [(1, true), (1, false)]);
    let requests = server.finish().await;
    assert!(
        requests[0].starts_with("GET /api/v4/channels/c/posts?per_page=60&page=0&before=newest ")
    );
    assert!(
        requests[2].starts_with("GET /api/v4/channels/c/posts?per_page=60&page=0&before=middle ")
    );
}
