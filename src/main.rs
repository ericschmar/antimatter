use antimatter::{
    SessionScope,
    conversation::{self, Intent, Pending, Update},
    mattermost::{self, Channel, Post, Secret, ServerOrigin},
    websocket,
};
use rune::tok::{self, motion, type_};
use rune::{AppHandle, AppSpec, Cx, El, TextEdit, col, el, text, text_input};
use std::sync::Arc;
use tokio::sync::mpsc;

struct State {
    on: bool,
    auth_proof: bool,
    application: bool,
    synthetic: bool,
    pat: TextEdit,
    password: TextEdit,
    server: TextEdit,
    login: TextEdit,
    draft: TextEdit,
    handle: Option<AppHandle<State>>,
    runtime: Option<Arc<tokio::runtime::Runtime>>,
    scope: SessionScope,
    intents: Option<mpsc::Sender<Intent>>,
    account: Option<String>,
    channel: Option<String>,
    channels: Vec<Channel>,
    posts: Vec<Post>,
    pending: Option<Pending>,
    ready: bool,
    busy: bool,
    connection: websocket::State,
    error: Option<&'static str>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            on: false,
            auth_proof: false,
            application: false,
            synthetic: false,
            pat: TextEdit::default().secure(),
            password: TextEdit::default().secure(),
            server: TextEdit::default(),
            login: TextEdit::default(),
            draft: TextEdit::default(),
            handle: None,
            runtime: None,
            scope: SessionScope::default(),
            intents: None,
            account: None,
            channel: None,
            channels: vec![],
            posts: vec![],
            pending: None,
            ready: false,
            busy: false,
            connection: websocket::State::Idle,
            error: None,
        }
    }
}

impl State {
    fn clear_session(&mut self) {
        self.scope.cancel();
        self.intents = None;
        self.account = None;
        self.channel = None;
        self.channels.clear();
        self.posts.clear();
        self.pending = None;
        self.draft.clear();
        self.ready = false;
        self.busy = false;
        self.connection = websocket::State::Idle;
        self.error = None;
    }

    fn connect(&mut self, password: bool) {
        if self.busy || self.synthetic {
            return;
        }
        let Some(runtime) = self.runtime.clone() else {
            return;
        };
        let Some(handle) = self.handle.clone() else {
            return;
        };
        let value = if password {
            std::mem::take(&mut self.password.text)
        } else {
            std::mem::take(&mut self.pat.text)
        };
        self.password.clear();
        self.pat.clear();
        self.clear_session();
        let allow_http = std::env::args().any(|a| a == "--dev-http");
        let origin = ServerOrigin::new(&self.server.text, allow_http);
        let token = Secret::new(value);
        let (Ok(origin), Ok(token)) = (origin, token) else {
            self.error = Some("Enter a valid server and credential.");
            return;
        };
        let login = self.login.text.clone();
        let (generation, mut stop) = self.scope.replace();
        self.busy = true;
        runtime.spawn(async move {
            let result = tokio::select! {
                _ = stop.changed() => return,
                result = async {
                    if password { mattermost::sign_in_password(origin, &login, token).await }
                    else { mattermost::sign_in_pat(origin, token).await }
                } => result,
            };
            let (client, user) = match result {
                Ok(result) => result,
                Err(_) => {
                    handle.update(move |s, _| {
                        if s.scope.accepts(generation) {
                            s.busy = false;
                            s.error = Some("Sign-in failed. Check the server and credentials.");
                        }
                    });
                    return;
                }
            };
            let account = format!("{} · {}", client.origin().as_str(), user.username);
            let (intents_tx, intents_rx) = mpsc::channel(32);
            let (socket_tx, socket_rx) = mpsc::channel(64);
            let (updates_tx, mut updates_rx) = mpsc::channel(64);
            handle.update(move |s, _| {
                if s.scope.accepts(generation) {
                    s.account = Some(account);
                    s.intents = Some(intents_tx);
                    s.busy = false;
                    s.dispatch(Intent::Refresh);
                }
            });
            let socket_client = client.clone();
            let socket = socket_client.websocket(stop.clone(), socket_tx);
            let conversation =
                conversation::run(client, user.id, intents_rx, socket_rx, updates_tx);
            let updates = async {
                while let Some(update) = updates_rx.recv().await {
                    handle.update(move |s, _| {
                        if s.scope.accepts(generation) {
                            s.apply(update);
                        }
                    });
                }
            };
            tokio::select! {
                _ = stop.changed() => (),
                _ = async { tokio::join!(socket, conversation, updates); } => (),
            }
        });
    }

    fn dispatch(&mut self, intent: Intent) -> bool {
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

    fn load(&mut self, channel: String) {
        if !self.ready || self.pending.is_some() || !self.draft.text.is_empty() {
            return;
        }
        if self.dispatch(Intent::Load(channel.clone())) {
            self.channel = Some(channel);
            self.posts.clear();
            self.ready = false;
            self.error = None;
        }
    }

    fn send(&mut self) {
        if !self.ready
            || self.pending.is_some()
            || self.channel.is_none()
            || self.draft.text.trim().is_empty()
        {
            return;
        }
        let message = self.draft.text.clone();
        if let Some(sender) = &self.intents {
            if sender.try_send(Intent::Send(message)).is_ok() {
                self.ready = false;
                self.error = None;
            } else {
                self.error = Some("Service is busy. Draft retained.");
            }
        }
    }

    fn apply(&mut self, update: Update) {
        match update {
            Update::Navigation { channels, .. } => self.channels = channels,
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
                    self.draft.clear();
                }
                self.pending = pending;
            }
            Update::Ready(ready) => self.ready = ready,
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

fn button(
    key: &str,
    label: &str,
    disabled: bool,
    action: impl Fn(&mut State) + Send + Sync + 'static,
) -> El {
    let control = el()
        .key(key)
        .label(label)
        .disabled(disabled)
        .padding(8.0)
        .radius(4.0)
        .fill(tok::theme(true).control_off)
        .on_press(move |s| {
            if !disabled {
                action(s);
            }
        })
        .child(text(label).color(tok::theme(true).text));
    if disabled { control.inert() } else { control }
}

fn application(s: &State) -> El {
    let t = tok::theme(true);
    let mut body = col()
        .w_full()
        .h_full()
        .padding(16.0)
        .gap(8.0)
        .fill(t.bg)
        .child(text("Antimatter").font(type_::TITLE).color(t.text));
    if let Some(account) = &s.account {
        body = body
            .child(text(account).color(t.text))
            .child(
                text(format!(
                    "Connection: {:?}{}",
                    s.connection,
                    if s.ready { "" } else { " · refreshing" }
                ))
                .color(t.text),
            )
            .child(
                text("Disconnect discards session-only drafts and pending delivery state.")
                    .color(t.text),
            )
            .child(button("disconnect", "Disconnect session", false, |s| {
                s.clear_session()
            }))
            .child(button(
                "reload",
                "Reload",
                !s.ready && s.error.is_none(),
                |s| {
                    if s.dispatch(Intent::Refresh) {
                        s.ready = false;
                        s.error = None;
                    }
                },
            ));
        let rows = s.channels.iter().map(|channel| {
            let id = channel.id.clone();
            button(
                &format!("channel-{}", channel.id),
                &channel.display_name,
                !s.ready || s.pending.is_some() || !s.draft.text.is_empty(),
                move |s| s.load(id.clone()),
            )
        });
        body = body.child(
            col()
                .h(70.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .children(rows),
        );
        body = body
            .child(
                col()
                    .key("timeline")
                    .grow(1.0)
                    .min_h(0.0)
                    .scroll(rune::ScrollSpec { stick_bottom: true })
                    .children(s.posts.iter().map(|post| {
                        text(&post.message)
                            .key(format!("post-{}", post.id))
                            .color(t.text)
                    })),
            )
            .child(if !s.ready || s.pending.is_some() {
                text_input(&s.draft, type_::BODY)
                    .key("draft")
                    .label("Message")
                    .w_full()
                    .h(60.0)
                    .disabled(true)
                    .read_only(true)
                    .inert()
            } else {
                text_input(&s.draft, type_::BODY)
                    .key("draft")
                    .label("Message")
                    .w_full()
                    .h(60.0)
                    .on_edit(|s: &mut State| &mut s.draft)
            })
            .child(button(
                "send",
                "Send",
                !s.ready
                    || s.pending.is_some()
                    || s.channel.is_none()
                    || s.draft.text.trim().is_empty(),
                |s| s.send(),
            ));
        if let Some(pending) = &s.pending {
            body = body
                .child(
                    text(if pending.failed {
                        "Pending delivery · draft retained"
                    } else {
                        "Sending…"
                    })
                    .color(t.text),
                )
                .child(button(
                    "retry",
                    if pending.retryable {
                        "Retry rejected send"
                    } else {
                        "Check delivery (no resend)"
                    },
                    !pending.failed || !s.ready,
                    |s| {
                        if s.dispatch(Intent::Retry) {
                            s.ready = false;
                        }
                    },
                ));
        }
    } else {
        body = body
            .child(text("Session only · credentials are not saved").color(t.text))
            .child(
                text_input(&s.server, type_::BODY)
                    .key("server")
                    .label("Server HTTPS origin")
                    .single_line()
                    .w_full()
                    .h(36.0)
                    .on_edit(|s: &mut State| &mut s.server),
            )
            .child(
                text_input(&s.pat, type_::BODY)
                    .key("pat")
                    .label("Personal access token")
                    .single_line()
                    .w_full()
                    .h(36.0)
                    .on_edit(|s: &mut State| &mut s.pat),
            )
            .child(button("connect-pat", "Connect with PAT", s.busy, |s| {
                s.connect(false)
            }))
            .child(
                text_input(&s.login, type_::BODY)
                    .key("login")
                    .label("Username or email")
                    .single_line()
                    .w_full()
                    .h(36.0)
                    .on_edit(|s: &mut State| &mut s.login),
            )
            .child(
                text_input(&s.password, type_::BODY)
                    .key("password")
                    .label("Password")
                    .single_line()
                    .w_full()
                    .h(36.0)
                    .on_edit(|s: &mut State| &mut s.password),
            )
            .child(button(
                "connect-password",
                "Connect with password",
                s.busy,
                |s| s.connect(true),
            ));
    }
    if let Some(error) = s.error {
        body = body.child(text(error).color(t.text));
    }
    body
}

fn view(s: &State, _: &mut Cx<State>) -> El {
    let t = tok::theme(true);
    if s.application {
        return application(s);
    }
    if s.auth_proof {
        return col()
            .w_full()
            .h_full()
            .padding(16.0)
            .gap(12.0)
            .fill(t.bg)
            .child(
                text("Synthetic secure-input check")
                    .font(type_::BODY)
                    .color(t.text),
            )
            .child(
                text_input(&s.pat, type_::BODY)
                    .key("pat")
                    .label("Personal access token")
                    .single_line()
                    .w_full()
                    .h(40.0)
                    .on_edit(|s: &mut State| &mut s.pat),
            )
            .child(
                text_input(&s.password, type_::BODY)
                    .key("password")
                    .label("Password")
                    .single_line()
                    .w_full()
                    .h(40.0)
                    .on_edit(|s: &mut State| &mut s.password),
            );
    }
    let label = text(if s.on { "Lights on" } else { "Lights off" })
        .font(type_::TITLE)
        .color(t.text);
    let knob = el()
        .key("knob")
        .size(18.0, 18.0)
        .radius(9.0)
        .fill(t.knob)
        .absolute(if s.on { 18.0 } else { 2.0 }, 2.0);
    let switch = el()
        .key("switch")
        .role("switch")
        .label("Lights")
        .checked(s.on)
        .focusable(true)
        .size(38.0, 22.0)
        .radius(11.0)
        .fill(if s.on {
            tok::accent(0, true)
        } else {
            t.control_off
        })
        .motion(motion::SNAPPY)
        .on_press(|s: &mut State| s.on = !s.on)
        .child(knob);
    col()
        .w_full()
        .h_full()
        .center()
        .gap(16.0)
        .fill(t.bg)
        .child(label)
        .child(switch)
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    if !rune::is_headless()
        && args
            .iter()
            .any(|a| a == "--trace" || a.starts_with("--trace="))
    {
        eprintln!("Native sessions forbid tracing.");
        std::process::exit(2);
    }
    if args.iter().any(|a| a == "--real-account")
        && (rune::is_headless()
            || args
                .iter()
                .any(|a| a == "--trace" || a.starts_with("--trace=")))
    {
        eprintln!("Real-account mode forbids headless exports.");
        std::process::exit(2);
    }
    let app = rune::App::new(AppSpec::<State> {
        scenes: &[
            ("on", |s| {
                s.application = false;
                s.on = true;
            }),
            ("hello", |s| s.application = false),
            ("auth-proof", |s| {
                s.application = false;
                s.auth_proof = true;
                s.pat = TextEdit::new("synthetic-pat-do-not-export").secure();
                s.password = TextEdit::new("synthetic-password-do-not-export").secure();
            }),
            ("conversation-proof", |s| {
                s.application = true;
                s.synthetic = true;
                s.account = Some("Synthetic conversation · no real account".into());
                s.channel = Some("synthetic-channel".into());
                s.ready = true;
                s.connection = websocket::State::Connected;
                s.posts.push(Post {
                    id: "synthetic-post".into(),
                    channel_id: "synthetic-channel".into(),
                    user_id: "synthetic-user".into(),
                    message: "Synthetic service conversation".into(),
                    create_at: 1,
                    update_at: 0,
                    delete_at: 0,
                    pending_post_id: String::new(),
                });
            }),
        ],
        ..AppSpec::new(
            "Antimatter",
            if rune::is_headless() {
                (320.0, 200.0)
            } else {
                (640.0, 640.0)
            },
            State::default,
            view,
        )
    });
    let handle = app.handle();
    app.init(move || {
        let mut state = State::default();
        if !rune::is_headless() {
            state.application = true;
            state.runtime = Some(Arc::new(
                tokio::runtime::Runtime::new().expect("background runtime"),
            ));
            state.handle = Some(handle);
        }
        state
    })
    .run();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune::{Env, Runtime};
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn ui(sender: mpsc::Sender<Intent>) -> Runtime<State> {
        let state = State {
            application: true,
            account: Some("synthetic account".into()),
            channel: Some("c".into()),
            channels: vec![Channel {
                id: "other".into(),
                team_id: "t".into(),
                name: "other".into(),
                display_name: "Other".into(),
                kind: "O".into(),
            }],
            intents: Some(sender),
            ready: true,
            ..State::default()
        };
        let mut rt = Runtime::new(
            state,
            view,
            (640.0, 800.0),
            Env {
                system_dark: true,
                scale: 2.0,
            },
        );
        rt.invalidate();
        rt.frame(0.0);
        rt
    }

    fn tap(rt: &mut Runtime<State>, key: &str) {
        rt.invalidate();
        for _ in 0..60 {
            rt.frame(1.0 / 60.0);
        }
        let (x, y) = rt.find(key).unwrap();
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.invalidate();
        rt.frame(0.0);
    }

    fn inert(rt: &Runtime<State>, key: &str) -> bool {
        rt.elements()
            .iter()
            .find(|e| e.key.as_deref() == Some(key))
            .unwrap()
            .inert
    }

    fn pending() -> Pending {
        Pending {
            post: mattermost::CreatePost {
                channel_id: "c".into(),
                message: "keep text".into(),
                pending_post_id: "synthetic-pending".into(),
            },
            failed: false,
            retryable: false,
        }
    }

    fn post(pending_id: &str) -> Post {
        Post {
            id: "sent".into(),
            channel_id: "c".into(),
            user_id: "u".into(),
            message: "keep text".into(),
            create_at: 100,
            update_at: 100,
            delete_at: 0,
            pending_post_id: pending_id.into(),
        }
    }

    #[test]
    fn send_tap_locks_composer_before_worker_acknowledges() {
        let (sender, mut intents) = mpsc::channel(8);
        let mut rt = ui(sender);
        rt.state.draft.text = "keep text".into();
        rt.invalidate();
        rt.frame(0.0);
        assert!(!inert(&rt, "draft"));
        assert!(!inert(&rt, "send"));
        tap(&mut rt, "send");
        assert!(!rt.state.ready);
        assert!(rt.state.pending.is_none());
        assert_eq!(rt.state.draft.text, "keep text");
        tap(&mut rt, "draft");
        rt.paste("late edit");
        rt.invalidate();
        rt.frame(0.0);
        assert_eq!(rt.state.draft.text, "keep text");
        assert!(inert(&rt, "draft"));
        assert!(inert(&rt, "send"));
        tap(&mut rt, "send");
        assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "keep text"));
        assert!(intents.try_recv().is_err());
    }

    #[test]
    fn pending_acknowledgement_does_not_unlock_refresh() {
        let (sender, _intents) = mpsc::channel(8);
        let mut rt = ui(sender);
        rt.state.draft.text = "keep text".into();
        rt.state.apply(Update::Pending(Some(pending())));
        tap(&mut rt, "reload");
        assert!(!rt.state.ready);
        rt.state.apply(Update::Pending(None));
        rt.invalidate();
        rt.frame(0.0);
        assert!(rt.state.draft.text.is_empty());
        assert!(rt.state.pending.is_none());
        assert!(!rt.state.ready);
        assert!(inert(&rt, "draft"));
        assert!(inert(&rt, "channel-other"));
        rt.state.apply(Update::Ready(true));
        rt.invalidate();
        rt.frame(0.0);
        assert!(!inert(&rt, "draft"));
        assert!(!inert(&rt, "channel-other"));
    }

    #[test]
    fn failed_enqueue_retains_channel_timeline_and_draft() {
        for closed in [false, true] {
            let (sender, mut intents) = mpsc::channel(1);
            if closed {
                intents.close();
            } else {
                sender.try_send(Intent::Refresh).unwrap();
            }
            let mut rt = ui(sender);
            rt.state.posts.push(post(""));
            tap(&mut rt, "channel-other");
            assert_eq!(rt.state.channel.as_deref(), Some("c"));
            assert_eq!(rt.state.posts, vec![post("")]);
            assert!(rt.state.ready);
            assert!(rt.state.error.is_some());
            tap(&mut rt, "reload");
            assert!(rt.state.ready);
            rt.state.draft.text = "keep text".into();
            tap(&mut rt, "send");
            assert_eq!(rt.state.draft.text, "keep text");
            assert!(rt.state.ready);
            assert!(rt.state.pending.is_none());
            assert_eq!(rt.state.channel.as_deref(), Some("c"));
            assert_eq!(rt.state.posts, vec![post("")]);
            assert!(!inert(&rt, "draft"));
            assert!(rt.state.error.is_some());
        }
    }

    #[test]
    fn disconnect_rejects_late_updates_from_cancelled_scope() {
        let (sender, _intents) = mpsc::channel(8);
        let mut rt = ui(sender);
        let (generation, stop) = rt.state.scope.replace();
        rt.state.draft.text = "keep text".into();
        rt.state.pending = Some(pending());
        rt.state.posts.push(post(""));
        tap(&mut rt, "disconnect");
        assert!(*stop.borrow());
        assert!(!rt.state.scope.accepts(generation));
        let (replacement, _stop) = rt.state.scope.replace();
        for update in [
            Update::Pending(Some(pending())),
            Update::Upsert(post("")),
            Update::Ready(true),
        ] {
            if rt.state.scope.accepts(generation) {
                rt.state.apply(update);
            }
        }
        assert!(rt.state.scope.accepts(replacement));
        assert!(rt.state.account.is_none());
        assert!(rt.state.channel.is_none());
        assert!(rt.state.intents.is_none());
        assert!(rt.state.posts.is_empty());
        assert!(rt.state.pending.is_none());
        assert!(rt.state.draft.text.is_empty());
        assert!(!rt.state.ready);
        rt.invalidate();
        rt.frame(0.0);
        assert!(rt.find("send").is_none());
        assert!(rt.find("connect-pat").is_some());
    }

    async fn next(updates: &mut mpsc::Receiver<Update>) -> Update {
        tokio::time::timeout(Duration::from_secs(3), updates.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn rune_send_checks_lost_response_delivery_without_duplicate() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin =
            ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
        let server = tokio::spawn(async move {
            let mut requests = vec![];
            let mut pending_id = String::new();
            for step in 0..6 {
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
                if step == 4 {
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
                assert!(request.starts_with("GET "));
                let body = if path.ends_with("/users/me/teams") {
                    json!([{"id":"t","name":"team"}])
                } else if path.contains("/teams/t/channels?") {
                    json!([{"id":"c","team_id":"t","name":"channel","type":"O"}])
                } else if path.ends_with("/channels/c") {
                    json!({"id":"c","team_id":"t","name":"channel","type":"O"})
                } else {
                    assert!(path.starts_with("/api/v4/channels/c/posts?"));
                    assert!(path.contains("per_page=60"));
                    if step == 5 {
                        json!({"order":["sent"],"posts":{"sent":post(&pending_id)},"prev_post_id":""})
                    } else {
                        json!({"order":[],"posts":{},"prev_post_id":""})
                    }
                }.to_string();
                requests.push(request);
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
            requests
        });
        let client = mattermost::Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap();
        let (sender, intents) = mpsc::channel(8);
        let (ws, events) = mpsc::channel(8);
        let (tx, mut updates) = mpsc::channel(16);
        let worker = tokio::spawn(conversation::run(client, "u".into(), intents, events, tx));
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
            requests.iter().filter(|r| r.starts_with("POST ")).count(),
            1
        );
        assert_eq!(requests.len(), 6);
        worker.abort();
        assert!(worker.await.unwrap_err().is_cancelled());
    }

    #[test]
    fn a_tap_flips_the_switch_and_the_knob_springs_across() {
        let env = Env {
            system_dark: true,
            scale: 2.0,
        };
        let mut rt = Runtime::new(State::default(), view, (320.0, 200.0), env);
        rt.invalidate();
        rt.frame(0.0);
        let knob_x = |rt: &Runtime<State>| rt.presented("knob").unwrap().0[0];
        let off = knob_x(&rt);
        let (x, y) = rt.find("switch").unwrap();
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        for _ in 0..6 {
            rt.frame(1.0 / 60.0);
        }
        assert!(rt.state.on);
        let mid = knob_x(&rt);
        for _ in 0..60 {
            rt.frame(1.0 / 60.0);
        }
        let on = knob_x(&rt);
        assert!(off < mid && mid < on);
        assert!((on - off - 16.0).abs() < 0.01);
    }
}
