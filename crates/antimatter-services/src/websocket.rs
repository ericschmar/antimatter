use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;
use tokio::{
    sync::{mpsc, watch},
    time::{Instant, sleep, sleep_until, timeout},
};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{Error as SocketError, Message, protocol::WebSocketConfig},
};

use crate::mattermost::{Secret, ServerOrigin};

const PING_INTERVAL: Duration = Duration::from_secs(25);
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    Transport,
    AuthenticationRejected,
    AuthenticationTimeout,
    HeartbeatTimeout,
    MalformedFrame,
    SequenceExhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Idle,
    Connecting,
    Connected,
    Disconnected,
    Error(Failure),
}

pub enum Event {
    State(State),
    Wire(WireEvent),
    Refresh,
}

#[derive(Deserialize)]
pub struct WireEvent {
    pub event: String,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub broadcast: Value,
    #[serde(default)]
    pub seq: Option<u64>,
}

impl WireEvent {
    pub fn nested<T: DeserializeOwned>(&self, key: &str) -> Result<T, serde_json::Error> {
        let data = match &self.data {
            Value::String(text) => serde_json::from_str(text)?,
            value => value.clone(),
        };
        let value = data.get(key).cloned().unwrap_or(Value::Null);
        match value {
            Value::String(text) => serde_json::from_str(&text),
            value => serde_json::from_value(value),
        }
    }
}

pub async fn run(
    origin: ServerOrigin,
    secret: Secret,
    stop: watch::Receiver<bool>,
    events: mpsc::Sender<Event>,
) {
    run_session(&origin, secret.expose(), stop, &events).await;
}

async fn run_session(
    origin: &ServerOrigin,
    secret: &str,
    mut stop: watch::Receiver<bool>,
    events: &mpsc::Sender<Event>,
) {
    let stopped = tokio::select! {
        biased;
        _ = cancelled(&mut stop) => true,
        _ = events.closed() => true,
        _ = worker(origin, secret, events) => false,
    };
    if stopped {
        let _ = events.try_send(Event::State(State::Idle));
    }
}

async fn cancelled(stop: &mut watch::Receiver<bool>) {
    loop {
        if *stop.borrow_and_update() || stop.changed().await.is_err() {
            return;
        }
    }
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_secs((1_u64 << attempt.min(5)).min(30))
}

fn sequence(next: &mut u64) -> Result<u64, Failure> {
    let current = *next;
    *next = next.checked_add(1).ok_or(Failure::SequenceExhausted)?;
    Ok(current)
}

async fn emit(events: &mpsc::Sender<Event>, event: Event) -> Result<(), ()> {
    timeout(REPLY_TIMEOUT, events.send(event))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

async fn worker(origin: &ServerOrigin, secret: &str, events: &mpsc::Sender<Event>) {
    let mut next = 1;
    let mut attempt = 0;
    let mut previously_authenticated = false;
    if emit(events, Event::State(State::Idle)).await.is_err() {
        return;
    }
    loop {
        if emit(events, Event::State(State::Connecting)).await.is_err() {
            return;
        }
        let config = WebSocketConfig::default()
            .max_message_size(Some(1024 * 1024))
            .max_frame_size(Some(1024 * 1024));
        let connection = timeout(
            REPLY_TIMEOUT,
            connect_async_with_config(origin.websocket_url().as_str(), Some(config), true),
        )
        .await;
        let failure = match connection {
            Ok(Ok((socket, _))) => {
                match receive(
                    socket,
                    secret,
                    events,
                    &mut next,
                    &mut attempt,
                    &mut previously_authenticated,
                )
                .await
                {
                    Ok(()) => return,
                    Err(failure) => failure,
                }
            }
            Ok(Err(SocketError::Http(response)))
                if matches!(response.status().as_u16(), 401 | 403) =>
            {
                Failure::AuthenticationRejected
            }
            _ => Failure::Transport,
        };
        if emit(events, Event::State(State::Error(failure)))
            .await
            .is_err()
        {
            return;
        }
        if failure == Failure::AuthenticationRejected || failure == Failure::SequenceExhausted {
            return;
        }
        if emit(events, Event::State(State::Disconnected))
            .await
            .is_err()
        {
            return;
        }
        let delay = backoff(attempt);
        attempt = attempt.saturating_add(1);
        sleep(delay).await;
    }
}

async fn receive(
    mut socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    secret: &str,
    events: &mpsc::Sender<Event>,
    next: &mut u64,
    attempt: &mut u32,
    previously_authenticated: &mut bool,
) -> Result<(), Failure> {
    let auth_seq = sequence(next)?;
    #[derive(serde::Serialize)]
    struct Auth<'a> {
        seq: u64,
        action: &'static str,
        data: Token<'a>,
    }
    #[derive(serde::Serialize)]
    struct Token<'a> {
        token: &'a str,
    }
    let auth = serde_json::to_string(&Auth {
        seq: auth_seq,
        action: "authentication_challenge",
        data: Token { token: secret },
    })
    .map_err(|_| Failure::Transport)?;
    timeout(REPLY_TIMEOUT, socket.send(Message::Text(auth.into())))
        .await
        .map_err(|_| Failure::Transport)?
        .map_err(|_| Failure::Transport)?;
    let mut authenticated = false;
    let mut pending = Some((auth_seq, Instant::now() + REPLY_TIMEOUT));
    let mut next_ping = Instant::now() + PING_INTERVAL;
    loop {
        let wake = pending.map(|(_, deadline)| deadline).unwrap_or(next_ping);
        let message = tokio::select! {
            biased;
            _ = sleep_until(wake) => {
                if pending.is_some() {
                    return Err(if authenticated { Failure::HeartbeatTimeout } else { Failure::AuthenticationTimeout });
                }
                let seq = sequence(next)?;
                let ping = serde_json::json!({"seq": seq, "action": "ping"}).to_string();
                timeout(REPLY_TIMEOUT, socket.send(Message::Text(ping.into())))
                    .await.map_err(|_| Failure::Transport)?.map_err(|_| Failure::Transport)?;
                pending = Some((seq, Instant::now() + REPLY_TIMEOUT));
                next_ping += PING_INTERVAL;
                continue;
            },
            message = socket.next() => message,
        };
        let bytes = match message {
            Some(Ok(Message::Text(text))) => text.as_bytes().to_vec(),
            Some(Ok(Message::Binary(bytes))) => bytes.to_vec(),
            Some(Ok(Message::Ping(_))) => {
                timeout(REPLY_TIMEOUT, socket.flush())
                    .await
                    .map_err(|_| Failure::Transport)?
                    .map_err(|_| Failure::Transport)?;
                continue;
            }
            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return Err(Failure::Transport),
            _ => continue,
        };
        let value: Value = match serde_json::from_slice(&bytes) {
            Ok(Value::Object(object)) => Value::Object(object),
            _ => {
                if emit(events, Event::State(State::Error(Failure::MalformedFrame)))
                    .await
                    .is_err()
                {
                    return Ok(());
                }
                continue;
            }
        };
        let reply = value.get("seq_reply").and_then(Value::as_u64);
        let status = value.get("status").and_then(Value::as_str);
        let hello = value.get("event").and_then(Value::as_str) == Some("hello");
        if !authenticated
            && reply == Some(auth_seq)
            && (status == Some("FAIL") || value.get("error").is_some_and(|e| !e.is_null()))
        {
            return Err(Failure::AuthenticationRejected);
        }
        if !authenticated && ((reply == Some(auth_seq) && status == Some("OK")) || hello) {
            authenticated = true;
            pending = None;
            next_ping = Instant::now() + PING_INTERVAL;
            *attempt = 0;
            if *previously_authenticated && emit(events, Event::Refresh).await.is_err() {
                return Ok(());
            }
            *previously_authenticated = true;
            if emit(events, Event::State(State::Connected)).await.is_err() {
                return Ok(());
            }
        } else if authenticated
            && pending.is_some_and(|(seq, _)| reply == Some(seq))
            && status == Some("OK")
        {
            pending = None;
        }
        if authenticated && value.get("event").is_some() {
            match serde_json::from_value::<WireEvent>(value) {
                Ok(event) if !event.event.is_empty() && event.event != "hello" => {
                    if emit(events, Event::Wire(event)).await.is_err() {
                        return Ok(());
                    }
                }
                Ok(_) => {}
                Err(_) => {
                    if emit(events, Event::State(State::Error(Failure::MalformedFrame)))
                        .await
                        .is_err()
                    {
                        return Ok(());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
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
        let task = tokio::spawn(async move {
            run_session(&origin, "synthetic-token", stopped, &events).await;
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
        let task = tokio::spawn(async move {
            run_session(&origin, "synthetic-token", stopped, &events).await;
        });
        tokio::task::yield_now().await;
        stop.send(true).unwrap();
        bounded(task).await.unwrap();
    }
}
