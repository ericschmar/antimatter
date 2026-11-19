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

pub struct Typing {
    pub channel_id: String,
    pub parent_id: String,
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
    typing: mpsc::Receiver<Typing>,
) {
    run_session(&origin, secret.expose(), stop, &events, typing).await;
}

async fn run_session(
    origin: &ServerOrigin,
    secret: &str,
    mut stop: watch::Receiver<bool>,
    events: &mpsc::Sender<Event>,
    mut typing: mpsc::Receiver<Typing>,
) {
    let stopped = tokio::select! {
        biased;
        _ = cancelled(&mut stop) => true,
        _ = events.closed() => true,
        _ = worker(origin, secret, events, &mut typing) => false,
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

async fn worker(
    origin: &ServerOrigin,
    secret: &str,
    events: &mpsc::Sender<Event>,
    typing: &mut mpsc::Receiver<Typing>,
) {
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
                    typing,
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
    typing: &mut mpsc::Receiver<Typing>,
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
            Some(outgoing) = typing.recv(), if authenticated => {
                let seq = sequence(next)?;
                let frame = serde_json::json!({
                    "seq": seq,
                    "action": "user_typing",
                    "data": {"channel_id": outgoing.channel_id, "parent_id": outgoing.parent_id},
                })
                .to_string();
                timeout(REPLY_TIMEOUT, socket.send(Message::Text(frame.into())))
                    .await.map_err(|_| Failure::Transport)?.map_err(|_| Failure::Transport)?;
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
mod tests;
