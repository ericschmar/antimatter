use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[tokio::test]
async fn rune_send_checks_lost_response_delivery_without_duplicate() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin =
        ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
    let server = tokio::spawn(async move {
        let mut requests = vec![];
        let mut pending_id = String::new();
        for step in 0..11 {
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
            let path = request.split_whitespace().nth(1).unwrap();
            if step == 9 {
                assert!(request.starts_with("POST /api/v4/posts "));
                let body: Value =
                    serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                assert_eq!(body["channel_id"], "c");
                assert_eq!(body["message"], "keep text");
                pending_id = body["pending_post_id"].as_str().unwrap().into();
                assert!(uuid::Uuid::parse_str(&pending_id).is_ok());
                requests.push(request);
                drop(socket);
                continue;
            }
            let viewing = request.starts_with("POST /api/v4/channels/members/u/view ");
            assert!(viewing || request.starts_with("GET "));
            let body = if viewing {
                json!({"status":"OK"})
            } else if path.ends_with("/users/me/channels/c/unread") {
                json!({"channel_id":"c","msg_count":0,"mention_count":0})
            } else if path.ends_with("/users/me/teams") {
                json!([{"id":"t","name":"team"}])
            } else if path.starts_with("/api/v4/config/client?") {
                json!({"SiteName":"Synthetic Site"})
            } else if path.ends_with("/users/u/status") {
                json!({"user_id":"u","status":"online"})
            } else if path.contains("/teams/t/channels?") {
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}])
            } else if path.ends_with("/channels/c") {
                json!({"id":"c","team_id":"t","name":"channel","type":"O"})
            } else if path.starts_with("/api/v4/channels/c/members?") {
                json!([])
            } else {
                assert!(path.starts_with("/api/v4/channels/c/posts?"));
                assert!(path.contains("per_page=60"));
                if step == 10 {
                    json!({"order":["sent"],"posts":{"sent":post(&pending_id)},"prev_post_id":""})
                } else {
                    json!({"order":[],"posts":{},"prev_post_id":""})
                }
            }
            .to_string();
            requests.push(request);
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        }
        requests
    });
    let client = mattermost::Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap();
    let (sender, intents) = mpsc::channel(8);
    let (ws, events) = mpsc::channel(8);
    let (tx, mut updates) = mpsc::channel(16);
    let (typing, _typing_rx) = mpsc::channel(8);
    let worker = tokio::spawn(conversation::run(
        client,
        "u".into(),
        intents,
        events,
        typing,
        tx,
    ));
    let mut rt = ui(sender);
    rt.state.channel = None;
    rt.state.channels.clear();
    rt.state.load("c".into());
    while !rt.state.ready {
        let update = next(&mut updates).await;
        assert!(!matches!(update, Update::Failed(_)));
        rt.state.apply(update);
    }
    assert_eq!(rt.state.channels[0].id, "c");
    rt.state.draft.text = "keep text".into();
    tap(&mut rt, "send");
    assert!(!rt.state.ready);
    loop {
        let update = next(&mut updates).await;
        let failed = matches!(update, Update::Failed(conversation::Failure::Send));
        rt.state.apply(update);
        if failed {
            break;
        }
    }
    let pending_id = rt
        .state
        .pending
        .as_ref()
        .unwrap()
        .post
        .pending_post_id
        .clone();
    assert!(rt.state.pending.as_ref().unwrap().failed);
    assert!(!rt.state.pending.as_ref().unwrap().retryable);
    assert_eq!(rt.state.draft.text, "keep text");
    assert!(rt.state.ready);
    rt.invalidate();
    rt.frame(0.0);
    tap(&mut rt, "retry");
    assert!(!rt.state.ready);
    while !rt.state.ready {
        let update = next(&mut updates).await;
        assert!(!matches!(update, Update::Failed(_)));
        rt.state.apply(update);
    }
    assert!(rt.state.pending.is_none());
    assert!(rt.state.draft.text.is_empty());
    assert_eq!(rt.state.posts, vec![post(&pending_id)]);
    ws.send(websocket::Event::Wire(websocket::WireEvent {
        event: "posted".into(),
        data: json!({"post":post(&pending_id)}),
        broadcast: json!({}),
        seq: None,
    }))
    .await
    .unwrap();
    ws.send(websocket::Event::State(websocket::State::Disconnected))
        .await
        .unwrap();
    loop {
        let update = next(&mut updates).await;
        let disconnected = matches!(update, Update::Connection(websocket::State::Disconnected));
        assert!(!matches!(update, Update::Failed(_)));
        rt.state.apply(update);
        if disconnected {
            break;
        }
    }
    rt.invalidate();
    rt.frame(0.0);
    assert_eq!(rt.state.posts, vec![post(&pending_id)]);
    assert_eq!(
        rt.elements()
            .iter()
            .filter(|e| e.key.as_deref() == Some("post-sent"))
            .count(),
        1
    );
    let requests = tokio::time::timeout(Duration::from_secs(3), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.starts_with("POST /api/v4/posts "))
            .count(),
        1
    );
    assert_eq!(requests.len(), 11);
    worker.abort();
    assert!(worker.await.unwrap_err().is_cancelled());
}
