use super::*;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::{WebSocketStream, accept_async};

type Peer = WebSocketStream<TcpStream>;

async fn bounded<T>(future: impl std::future::Future<Output = T>) -> T {
    timeout(Duration::from_secs(2), future)
        .await
        .expect("test operation timed out")
}

async fn advance(duration: Duration) {
    tokio::time::pause();
    tokio::time::advance(duration).await;
    tokio::time::resume();
}

async fn start() -> (
    TcpListener,
    watch::Sender<bool>,
    mpsc::Receiver<Event>,
    JoinHandle<()>,
) {
    let listener = bounded(TcpListener::bind("127.0.0.1:0")).await.unwrap();
    let origin =
        ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
    let (stop, stopped) = watch::channel(false);
    let (events, receiver) = mpsc::channel(64);
    let (_typing, typing) = mpsc::channel(8);
    let task = tokio::spawn(async move {
        run_session(&origin, "synthetic-token", stopped, &events, typing).await;
    });
    (listener, stop, receiver, task)
}

async fn accept(listener: &TcpListener) -> (Peer, u64) {
    let (stream, _) = bounded(listener.accept()).await.unwrap();
    stream.set_nodelay(true).unwrap();
    let mut peer = bounded(accept_async(stream)).await.unwrap();
    let challenge = action(&mut peer).await;
    assert_eq!(challenge["action"], "authentication_challenge");
    assert_eq!(challenge["data"]["token"], "synthetic-token");
    (peer, challenge["seq"].as_u64().unwrap())
}

async fn action(peer: &mut Peer) -> Value {
    let frame = bounded(peer.next()).await.unwrap().unwrap();
    serde_json::from_slice(&frame.into_data()).unwrap()
}

async fn send(peer: &mut Peer, value: Value) {
    bounded(peer.send(Message::Text(value.to_string().into())))
        .await
        .unwrap();
}

async fn reply(peer: &mut Peer, seq: u64, status: &str) {
    send(
        peer,
        serde_json::json!({"seq_reply": seq, "status": status}),
    )
    .await;
}

async fn state(events: &mut mpsc::Receiver<Event>, wanted: State) {
    bounded(async {
        loop {
            let event = events.recv().await.expect("event channel closed");
            if let Event::State(actual) = event {
                if actual == wanted {
                    return;
                }
                assert!(
                    !matches!(actual, State::Error(_)),
                    "unexpected {actual:?}, wanted {wanted:?}"
                );
            }
        }
    })
    .await;
}

async fn processed(peer: &mut Peer, events: &mut mpsc::Receiver<Event>) {
    send(peer, serde_json::json!({"event":"future_event", "data":{}})).await;
    assert!(matches!(
        bounded(events.recv()).await,
        Some(Event::Wire(wire)) if wire.event == "future_event"
    ));
}

#[test]
fn nested_strings_and_backoff_cap() {
    for data in [
        serde_json::json!({"post":"{\"id\":\"p\"}"}),
        serde_json::json!("{\"post\":{\"id\":\"p\"}}"),
    ] {
        let wire: WireEvent =
            serde_json::from_value(serde_json::json!({"event":"posted", "data":data})).unwrap();
        assert_eq!(wire.nested::<Value>("post").unwrap()["id"], "p");
        assert!(wire.nested::<String>("missing").is_err());
    }
    assert_eq!(
        (0..8).map(|i| backoff(i).as_secs()).collect::<Vec<_>>(),
        [1, 2, 4, 8, 16, 30, 30, 30]
    );
    assert_eq!(backoff(u32::MAX).as_secs(), 30);
    let mut exhausted = u64::MAX;
    assert_eq!(sequence(&mut exhausted), Err(Failure::SequenceExhausted));
}

#[tokio::test]
async fn matching_auth_malformed_unknown_and_cancellation() {
    let (listener, stop, mut events, task) = start().await;
    let (mut peer, seq) = accept(&listener).await;
    state(&mut events, State::Connecting).await;
    reply(&mut peer, seq + 100, "OK").await;
    assert!(
        timeout(Duration::from_millis(20), events.recv())
            .await
            .is_err()
    );
    reply(&mut peer, seq, "OK").await;
    state(&mut events, State::Connected).await;
    bounded(peer.send(Message::Text("not-json".into())))
        .await
        .unwrap();
    state(&mut events, State::Error(Failure::MalformedFrame)).await;
    processed(&mut peer, &mut events).await;
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
    advance(Duration::from_secs(120)).await;
    assert!(futures_util::FutureExt::now_or_never(listener.accept()).is_none());
}

#[tokio::test]
async fn typing_is_sent_only_after_authentication() {
    let listener = bounded(TcpListener::bind("127.0.0.1:0")).await.unwrap();
    let origin =
        ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
    let (stop, stopped) = watch::channel(false);
    let (events, mut receiver) = mpsc::channel(64);
    let (typing_tx, typing_rx) = mpsc::channel(8);
    let task = tokio::spawn(async move {
        run_session(&origin, "synthetic-token", stopped, &events, typing_rx).await;
    });
    let (mut peer, seq) = accept(&listener).await;
    state(&mut receiver, State::Connecting).await;
    reply(&mut peer, seq, "OK").await;
    state(&mut receiver, State::Connected).await;
    typing_tx
        .send(Typing {
            channel_id: "c".into(),
            parent_id: "p".into(),
        })
        .await
        .unwrap();
    let frame = action(&mut peer).await;
    assert_eq!(frame["action"], "user_typing");
    assert_eq!(frame["data"]["channel_id"], "c");
    assert_eq!(frame["data"]["parent_id"], "p");
    assert!(frame["seq"].as_u64().unwrap() > seq);
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
}

#[tokio::test]
async fn heartbeat_matching_deadline_and_reconnect_refresh() {
    let (listener, stop, mut events, task) = start().await;
    let (mut peer, auth) = accept(&listener).await;
    reply(&mut peer, auth, "OK").await;
    state(&mut events, State::Connected).await;
    advance(PING_INTERVAL + Duration::from_millis(1)).await;
    let ping = action(&mut peer).await;
    assert_eq!(ping["action"], "ping");
    let ping_seq = ping["seq"].as_u64().unwrap();
    assert!(ping_seq > auth);
    reply(&mut peer, ping_seq, "OK").await;
    processed(&mut peer, &mut events).await;
    advance(REPLY_TIMEOUT + Duration::from_millis(1)).await;
    assert!(events.try_recv().is_err());
    advance(PING_INTERVAL - REPLY_TIMEOUT).await;
    let second = action(&mut peer).await;
    assert_eq!(second["action"], "ping");
    assert!(second["seq"].as_u64().unwrap() > ping_seq);
    reply(&mut peer, ping_seq, "OK").await;
    processed(&mut peer, &mut events).await;
    advance(REPLY_TIMEOUT + Duration::from_millis(1)).await;
    state(&mut events, State::Error(Failure::HeartbeatTimeout)).await;
    state(&mut events, State::Disconnected).await;
    advance(Duration::from_secs(1) + Duration::from_millis(1)).await;
    let (mut replacement, replacement_auth) = accept(&listener).await;
    assert!(replacement_auth > second["seq"].as_u64().unwrap());
    send(
        &mut replacement,
        serde_json::json!({"event":"hello", "data":{}}),
    )
    .await;
    state(&mut events, State::Connecting).await;
    assert!(matches!(bounded(events.recv()).await, Some(Event::Refresh)));
    assert!(matches!(
        bounded(events.recv()).await,
        Some(Event::State(State::Connected))
    ));
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
}

#[tokio::test]
async fn backoff_only_resets_on_auth_and_stop_prevents_retry() {
    let (listener, stop, mut events, task) = start().await;
    let (peer, first_seq) = accept(&listener).await;
    drop(peer);
    state(&mut events, State::Error(Failure::Transport)).await;
    state(&mut events, State::Disconnected).await;
    advance(Duration::from_secs(1) + Duration::from_millis(1)).await;
    let (peer, second_seq) = accept(&listener).await;
    assert!(second_seq > first_seq);
    drop(peer);
    state(&mut events, State::Error(Failure::Transport)).await;
    state(&mut events, State::Disconnected).await;
    advance(Duration::from_secs(1) + Duration::from_millis(1)).await;
    assert!(futures_util::FutureExt::now_or_never(listener.accept()).is_none());
    assert!(events.try_recv().is_err());
    advance(Duration::from_secs(1) + Duration::from_millis(1)).await;
    let (mut peer, third_seq) = accept(&listener).await;
    assert!(third_seq > second_seq);
    reply(&mut peer, third_seq, "OK").await;
    state(&mut events, State::Connected).await;
    bounded(peer.close(None)).await.unwrap();
    state(&mut events, State::Error(Failure::Transport)).await;
    state(&mut events, State::Disconnected).await;
    advance(Duration::from_secs(1) + Duration::from_millis(1)).await;
    let (peer, fourth_seq) = accept(&listener).await;
    assert!(fourth_seq > third_seq);
    drop(peer);
    state(&mut events, State::Error(Failure::Transport)).await;
    state(&mut events, State::Disconnected).await;
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
    advance(Duration::from_secs(120)).await;
    assert!(futures_util::FutureExt::now_or_never(listener.accept()).is_none());
}

#[tokio::test]
async fn auth_rejection_suspends_and_auth_timeout_is_bounded() {
    let (listener, _stop, mut events, task) = start().await;
    let (mut peer, seq) = accept(&listener).await;
    reply(&mut peer, seq, "FAIL").await;
    state(&mut events, State::Error(Failure::AuthenticationRejected)).await;
    bounded(task).await.unwrap();
    advance(Duration::from_secs(120)).await;
    assert!(futures_util::FutureExt::now_or_never(listener.accept()).is_none());
    let (listener, stop, mut events, task) = start().await;
    let (_peer, _) = accept(&listener).await;
    advance(REPLY_TIMEOUT + Duration::from_millis(1)).await;
    state(&mut events, State::Error(Failure::AuthenticationTimeout)).await;
    state(&mut events, State::Disconnected).await;
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
}

#[tokio::test]
async fn stop_during_handshake_and_backpressure() {
    let (listener, stop, _events, task) = start().await;
    let (_stream, _) = bounded(listener.accept()).await.unwrap();
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
    let origin = ServerOrigin::new("http://127.0.0.1:1", true).unwrap();
    let (stop, stopped) = watch::channel(false);
    let (events, _receiver) = mpsc::channel(1);
    bounded(events.send(Event::Refresh)).await.unwrap();
    let (_typing, typing) = mpsc::channel(1);
    let task = tokio::spawn(async move {
        run_session(&origin, "synthetic-token", stopped, &events, typing).await;
    });
    tokio::task::yield_now().await;
    stop.send(true).unwrap();
    bounded(task).await.unwrap();
}
