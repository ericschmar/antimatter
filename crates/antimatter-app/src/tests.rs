use crate::auth::*;
use crate::scenes::synthetic_workspace;
use crate::state::*;
use crate::view::view;
use antimatter_services::{
    accounts::{self, AccountKey, Draft, Navigation, Persistence},
    conversation::{self, Intent, Pending, Update},
    mattermost::{self, Channel, Post, Secret, ServerOrigin},
    websocket,
};
use rune::AppSpec;
use rune::{Env, Runtime};
use serde_json::{Value, json};
use std::time::Duration;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::mpsc;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[cfg(target_os = "macos")]
#[test]
fn rune_handle_supports_main_thread_browser_state() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<rune::AppHandle<Option<antimatter_services::macos::BrowserSession>>>();
}

#[derive(Default)]
struct FakeCredentials(std::collections::HashMap<AccountKey, Secret>);

impl accounts::CredentialStore for FakeCredentials {
    fn get(&self, key: &AccountKey) -> accounts::Result<Option<Secret>> {
        Ok(self.0.get(key).cloned())
    }
    fn save(&mut self, key: &AccountKey, token: &Secret) -> accounts::Result<()> {
        self.0.insert(key.clone(), token.clone());
        Ok(())
    }
    fn remove(&mut self, key: &AccountKey) -> accounts::Result<()> {
        self.0.remove(key);
        Ok(())
    }
}

struct TempRoot(std::path::PathBuf);
impl TempRoot {
    fn new() -> Self {
        Self(
            std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("antimatter-main-{}", uuid::Uuid::new_v4())),
        )
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn saved_key(user: &str) -> AccountKey {
    serde_json::from_value(json!({"origin": "https://example.test", "user_id": user})).unwrap()
}

#[test]
fn saved_identity_never_adopts_another_user() {
    assert!(validate_identity(Some(&saved_key("u")), &saved_key("u")).is_ok());
    assert!(validate_identity(Some(&saved_key("u")), &saved_key("other")).is_err());
    assert!(validate_identity(None, &saved_key("other")).is_ok());
}

#[tokio::test]
async fn metadata_startup_never_reads_credentials_and_missing_restore_preserves_selection() {
    struct NoReads;
    impl accounts::CredentialStore for NoReads {
        fn get(&self, _: &AccountKey) -> accounts::Result<Option<Secret>> {
            panic!("startup read credentials")
        }
        fn save(&mut self, _: &AccountKey, _: &Secret) -> accounts::Result<()> {
            Ok(())
        }
        fn remove(&mut self, _: &AccountKey) -> accounts::Result<()> {
            Ok(())
        }
    }
    let root = TempRoot::new();
    let store = Persistence::open(root.0.clone(), NoReads).await.unwrap();
    let key = saved_key("u");
    store
        .save(
            key.clone(),
            "synthetic".into(),
            Secret::new("fake".into()).unwrap(),
        )
        .await
        .unwrap();
    store.select(Some(key.clone())).await.unwrap();
    assert_eq!(store.accounts().await.unwrap().len(), 1);
    assert_eq!(store.selected().await.unwrap(), Some(key));
    let empty_root = TempRoot::new();
    let empty = Persistence::open(empty_root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    assert!(
        authenticate(
            Login::Saved(saved_key("missing")),
            Some(empty),
            false,
            1,
            None
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn durable_marker_survives_restart_and_checkpoint_keeps_other_channels() {
    let root = TempRoot::new();
    let key = saved_key("u");
    let mut credentials = FakeCredentials::default();
    credentials
        .0
        .insert(key.clone(), Secret::new("fake".into()).unwrap());
    let store = Persistence::open(root.0.clone(), credentials)
        .await
        .unwrap();
    store
        .save(
            key.clone(),
            "synthetic".into(),
            Secret::new("fake".into()).unwrap(),
        )
        .await
        .unwrap();
    let drafts = vec![
        Draft {
            pane_id: SUBMITTED.into(),
            channel_id: "c".into(),
            text: "possibly sent".into(),
        },
        Draft {
            pane_id: "unknown".into(),
            channel_id: "other".into(),
            text: "retained".into(),
        },
    ];
    store
        .checkpoint(
            key.clone(),
            drafts.clone(),
            Navigation {
                channel_id: Some("c".into()),
                ..Navigation::default()
            },
        )
        .await
        .unwrap();
    drop(store);
    let mut credentials = FakeCredentials::default();
    credentials
        .0
        .insert(key.clone(), Secret::new("fake".into()).unwrap());
    let reopened = Persistence::open(root.0.clone(), credentials)
        .await
        .unwrap();
    let (_, restored, navigation) = reopened.restore(key).await.unwrap();
    assert_eq!(restored, drafts);
    assert_eq!(navigation.channel_id.as_deref(), Some("c"));
    assert!(restored.iter().all(|d| d.pane_id != COMPOSER));
}

#[test]
fn submitted_restore_is_not_an_ordinary_draft_and_blocks_switch_send_and_signout() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.durable = Some(saved_key("u"));
    rt.state.drafts = vec![
        Draft {
            pane_id: SUBMITTED.into(),
            channel_id: "c".into(),
            text: "keep text".into(),
        },
        Draft {
            pane_id: "unknown-pane".into(),
            channel_id: "unknown-channel".into(),
            text: "orphan".into(),
        },
    ];
    rt.state.draft.text = "keep text".into();
    rt.state.recovered_pending = true;
    assert_eq!(rt.state.snapshot(), rt.state.drafts);
    rt.state.send();
    rt.state.select_account(saved_key("other"));
    rt.state.sign_out(saved_key("u"));
    assert!(intents.try_recv().is_err());
    assert_eq!(rt.state.draft.text, "keep text");
    assert!(rt.state.error.is_some());
    assert_eq!(rt.state.durable, Some(saved_key("u")));
}

#[test]
fn failed_durable_checkpoint_retains_content_and_navigation() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.durable = Some(saved_key("u"));
    rt.state.draft.text = "unsaved".into();
    rt.state.posts.push(post(""));
    rt.state
        .checkpoint(AfterCheckpoint::Select(saved_key("other")));
    assert_eq!(rt.state.channel.as_deref(), Some("c"));
    assert_eq!(rt.state.draft.text, "unsaved");
    assert_eq!(rt.state.posts, vec![post("")]);
    assert!(rt.state.error.is_some());
    assert!(intents.try_recv().is_err());
}

async fn durable_ui(sender: mpsc::Sender<Intent>) -> (TempRoot, Runtime<State>) {
    let root = TempRoot::new();
    let store = Persistence::open(root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    let key = saved_key("u");
    store
        .save(
            key.clone(),
            "synthetic".into(),
            Secret::new("fake".into()).unwrap(),
        )
        .await
        .unwrap();
    let mut rt = ui(sender);
    rt.state.durable = Some(key.clone());
    rt.state.authenticated = Some(key);
    rt.state.persistence = Some(store);
    rt.state.runtime = Some(Arc::new(tokio::runtime::Runtime::new().unwrap()));
    rt.state.handle =
        Some(rune::App::new(AppSpec::new("test", (640.0, 800.0), State::default, view)).handle());
    (root, rt)
}

#[test]
fn close_before_send_completion_restores_ordinary_draft_without_dispatch() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    executor.block_on(async {
        while !rt.state.write_task.as_ref().unwrap().is_finished() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert_eq!(
            store.restore(key.clone()).await.unwrap().1[0].pane_id,
            SUBMITTED
        );
    });
    rt.state.close();
    let (_, drafts, navigation) = executor.block_on(store.restore(key)).unwrap();
    assert_eq!(
        drafts,
        vec![Draft {
            pane_id: COMPOSER.into(),
            channel_id: "c".into(),
            text: "keep text".into(),
        }]
    );
    assert_eq!(navigation.channel_id.as_deref(), Some("c"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn close_after_send_acceptance_keeps_marker() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    executor
        .block_on(rt.state.write_task.take().unwrap())
        .unwrap();
    let drafts = executor.block_on(store.restore(key.clone())).unwrap().1;
    rt.state.complete_checkpoint(
        AfterCheckpoint::Send("keep text".into()),
        drafts.clone(),
        Ok(None),
    );
    assert!(rt.state.submitted);
    rt.state.close();
    assert_eq!(executor.block_on(store.restore(key)).unwrap().1, drafts);
    assert_eq!(drafts[0].pane_id, SUBMITTED);
    assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "keep text"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn empty_channel_switch_autosaves_navigation() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.load("other".into());
    executor
        .block_on(rt.state.write_task.take().unwrap())
        .unwrap();
    rt.state
        .complete_checkpoint(AfterCheckpoint::Load("other".into()), vec![], Ok(None));
    assert!(matches!(intents.try_recv(), Ok(Intent::Load(channel)) if channel == "other"));
    rt.state.autosave();
    assert!(rt.state.write_task.is_some());
    rt.state.close();
    let (_, drafts, navigation) = executor.block_on(store.restore(key)).unwrap();
    assert!(drafts.is_empty());
    assert_eq!(navigation.channel_id.as_deref(), Some("other"));
    assert!(intents.try_recv().is_err());
}

#[tokio::test]
async fn delayed_ack_completion_cannot_resurrect_marker_on_close() {
    let (sender, _intents) = mpsc::channel(8);
    let (_root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.submitted = true;
    rt.state.pending = Some(pending());
    rt.state.drafts = vec![Draft {
        pane_id: SUBMITTED.into(),
        channel_id: "c".into(),
        text: "keep text".into(),
    }];
    store
        .checkpoint(key.clone(), rt.state.drafts.clone(), Navigation::default())
        .await
        .unwrap();
    rt.state.apply(Update::Pending(None));
    let task = rt.state.write_task.take().unwrap();
    task.await.unwrap();
    assert!(rt.state.submitted);
    rt.state.close();
    assert!(store.restore(key).await.unwrap().1.is_empty());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn edit_autosaves_and_failed_enqueue_rolls_back_without_dispatch() {
    let (sender, mut intents) = mpsc::channel(1);
    sender.try_send(Intent::Refresh).unwrap();
    let (_root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    tap(&mut rt, "draft");
    rt.paste("keep text");
    rt.frame(0.0);
    assert_eq!(rt.state.draft.text, "keep text");
    rt.state.autosave();
    assert!(rt.state.busy);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key.clone()).await.unwrap().1;
    assert_eq!(saved[0].text, "keep text");
    rt.state
        .complete_checkpoint(AfterCheckpoint::Save, saved, Ok(None));
    rt.state.send();
    rt.state.write_task.take().unwrap().await.unwrap();
    let marker = store.restore(key.clone()).await.unwrap().1;
    assert_eq!(marker[0].pane_id, SUBMITTED);
    rt.state
        .complete_checkpoint(AfterCheckpoint::Send("keep text".into()), marker, Ok(None));
    assert!(rt.state.busy);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key).await.unwrap().1;
    assert_eq!(saved[0].pane_id, COMPOSER);
    rt.state
        .complete_checkpoint(AfterCheckpoint::Rollback, saved, Ok(None));
    assert!(!rt.state.recovered_pending);
    assert!(matches!(intents.try_recv(), Ok(Intent::Refresh)));
    assert!(intents.try_recv().is_err());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn checkpoint_io_error_never_dispatches_and_can_retry_rollback() {
    let (sender, mut intents) = mpsc::channel(8);
    let (root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    let account = store.accounts().await.unwrap().remove(0);
    let path = root.0.join(account.local_id).join("drafts.json");
    std::fs::create_dir_all(&path).unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    rt.state.write_task.take().unwrap().await.unwrap();
    let marker = rt.state.drafts.clone();
    rt.state.complete_checkpoint(
        AfterCheckpoint::Send("keep text".into()),
        marker.clone(),
        Err(accounts::Error::Invalid("test")),
    );
    rt.state.write_task.take().unwrap().await.unwrap();
    rt.state.complete_checkpoint(
        AfterCheckpoint::Rollback,
        marker,
        Err(accounts::Error::Invalid("test")),
    );
    assert!(rt.state.checkpoint_retry.is_some());
    assert!(!rt.state.recovered_pending);
    assert!(intents.try_recv().is_err());
    std::fs::remove_dir(path).unwrap();
    let retry = rt.state.checkpoint_retry.take().unwrap();
    rt.state.checkpoint(retry);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key).await.unwrap().1;
    assert_eq!(saved[0].pane_id, COMPOSER);
    assert_eq!(saved[0].text, "keep text");
    rt.state
        .complete_checkpoint(AfterCheckpoint::Rollback, saved, Ok(None));
    assert!(rt.state.checkpoint_retry.is_none());
    assert!(intents.try_recv().is_err());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn session_only_signout_cancels_only_matching_authenticated_identity() {
    for matching in [true, false] {
        let (sender, _intents) = mpsc::channel(8);
        let (_root, mut rt) = durable_ui(sender).await;
        let store = rt.state.persistence.clone().unwrap();
        let key = rt.state.durable.take().unwrap();
        rt.state.authenticated = Some(if matching {
            key.clone()
        } else {
            saved_key("other")
        });
        rt.state.selected = Some(key.clone());
        let (generation, stop) = rt.state.scope.replace();
        let result = store.sign_out(key.clone()).await;
        rt.state.complete_sign_out(key, result);
        assert_eq!(*stop.borrow(), matching);
        assert_eq!(rt.state.scope.accepts(generation), !matching);
        assert_eq!(rt.state.account.is_none(), matching);
        let runtime = rt.state.runtime.take().unwrap();
        tokio::task::spawn_blocking(move || drop(runtime))
            .await
            .unwrap();
    }
}

#[test]
fn persistence_errors_remain_retryable_and_auth_commit_blocks_cancel() {
    let mut s = State::default();
    let (generation, stop) = s.scope.replace();
    s.auth_writing = true;
    s.clear_session();
    assert!(s.scope.accepts(generation));
    assert!(!*stop.borrow());
    s.authenticate(Login::Saved(saved_key("other")));
    assert!(s.scope.accepts(generation));
    s.complete_checkpoint(
        AfterCheckpoint::Rollback,
        vec![],
        Err(accounts::Error::Invalid("synthetic failure")),
    );
    assert!(s.checkpoint_retry.is_some());
    assert!(!s.recovered_pending);
    assert!(s.blocked());
}

fn ui(sender: mpsc::Sender<Intent>) -> Runtime<State> {
    let state = State {
        application: true,
        account: Some("synthetic account".into()),
        channel: Some("c".into()),
        unread: HashMap::new(),
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
fn synthetic_workspace_selection_and_lock_stay_local() {
    let mut s = State::default();
    synthetic_workspace(&mut s);
    assert_eq!(s.sidebar.width(), 248.0);
    assert_eq!(s.channels.len(), 2);
    s.load("synthetic-other".into());
    assert_eq!(s.channel.as_deref(), Some("synthetic-other"));
    assert!(s.posts.is_empty());
    assert!(s.intents.is_none());
    let before = s.channel.clone();
    s.submitted = true;
    s.load("synthetic-channel".into());
    assert_eq!(s.channel, before);
    let mut rt = Runtime::new(
        s,
        view,
        (640.0, 640.0),
        Env {
            system_dark: true,
            scale: 2.0,
        },
    );
    rt.invalidate();
    rt.frame(0.0);
    assert!(inert(&rt, "draft"));
    assert!(inert(&rt, "send"));
    assert!(inert(&rt, "channel-synthetic-channel"));
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
    assert!(!*stop.borrow());
    assert_eq!(rt.state.draft.text, "keep text");
    assert!(inert(&rt, "disconnect"));
    rt.state.pending = None;
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
        for step in 0..8 {
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
            if step == 6 {
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
            } else if path.contains("/teams/t/channels?") {
                json!([{"id":"c","team_id":"t","name":"channel","type":"O"}])
            } else if path.ends_with("/channels/c") {
                json!({"id":"c","team_id":"t","name":"channel","type":"O"})
            } else {
                assert!(path.starts_with("/api/v4/channels/c/posts?"));
                assert!(path.contains("per_page=60"));
                if step == 7 {
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
        requests
            .iter()
            .filter(|r| r.starts_with("POST /api/v4/posts "))
            .count(),
        1
    );
    assert_eq!(requests.len(), 8);
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

fn synthetic_runtime() -> Runtime<State> {
    let mut s = State::default();
    synthetic_workspace(&mut s);
    let mut rt = Runtime::new(
        s,
        view,
        (800.0, 640.0),
        Env {
            system_dark: true,
            scale: 2.0,
        },
    );
    rt.invalidate();
    rt.frame(0.0);
    rt
}

fn tab_keys(rt: &Runtime<State>) -> Vec<String> {
    rt.elements()
        .iter()
        .filter(|e| e.role == "tab")
        .filter_map(|e| e.key.clone())
        .collect()
}

#[test]
fn sidebar_select_reuses_one_preview_tab_and_double_click_keeps_it() {
    let mut rt = synthetic_runtime();
    assert_eq!(rt.state.tab_order(), ["synthetic-channel"]);
    tap(&mut rt, "channel-synthetic-other");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.preview.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-channel", "synthetic-other"]
    );
    rt.state.load("synthetic-channel".into());
    assert_eq!(rt.state.preview.as_deref(), Some("synthetic-other"));
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-channel", "synthetic-other"]
    );
    assert!(rt.state.preview.is_none());
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(rt.state.navigation.tabs.len(), 2);
    rt.invalidate();
    rt.frame(0.0);
    assert_eq!(tab_keys(&rt), ["t-synthetic-channel", "t-synthetic-other"]);
}

#[test]
fn tab_close_activates_neighbour_and_last_tab_cannot_close() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.close_tab("synthetic-other");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    rt.state.close_tab("synthetic-channel");
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
}

#[test]
fn tab_switch_obeys_send_and_draft_guards() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.state.submitted = true;
    rt.state.close_tab("synthetic-channel");
    rt.state.load("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    assert_eq!(rt.state.navigation.tabs.len(), 2);
    rt.state.submitted = false;
    rt.state.recovered_pending = true;
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    rt.state.close_other_tabs("synthetic-other");
    assert_eq!(rt.state.navigation.tabs.len(), 2);
}

#[test]
fn each_tab_keeps_its_own_draft_across_switches() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.state.draft = rune::TextEdit::new("first");
    rt.state.load("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert!(rt.state.draft.text.is_empty());
    rt.state.draft = rune::TextEdit::new("second");
    rt.state.load("synthetic-channel".into());
    assert_eq!(rt.state.draft.text, "first");
    rt.state.close_tab("synthetic-channel");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.draft.text, "second");
}

#[test]
fn tab_context_actions_and_unread_status() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.invalidate();
    rt.frame(0.0);
    let other = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("t-synthetic-other"))
        .unwrap();
    assert_eq!(other.label.as_deref(), Some("synthetic-other"));
    assert!(!other.item_selected);
    assert!(
        rt.elements()
            .iter()
            .any(|e| e.key.as_deref() == Some("t-synthetic-channel") && e.item_selected)
    );
    rt.state.close_other_tabs("synthetic-channel");
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
}

#[test]
fn reorder_moves_durable_tabs_only() {
    let mut s = State::default();
    s.navigation.tabs = vec!["a".into(), "b".into(), "c".into()];
    s.reorder_tab(0, 2);
    assert_eq!(s.navigation.tabs, ["b", "c", "a"]);
    s.reorder_tab(0, 9);
    assert_eq!(s.navigation.tabs, ["b", "c", "a"]);
}

#[test]
fn cmd_w_closes_the_active_tab_and_never_the_window() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.on_key = Some(crate::tabs::window_key);
    let cmd = rune::Mods {
        cmd: true,
        ..rune::Mods::default()
    };
    rt.key(rune::KeyEvent {
        key: rune::Key::Command('w'),
        mods: cmd,
    });
    rt.frame(0.0);
    assert!(rt.shell_request.take().is_none());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-other"]);
}

#[test]
fn tab_titles_size_the_strip_and_every_tab_has_icon_and_close() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-other".into());
    rt.invalidate();
    rt.frame(0.0);
    let els = rt.elements();
    let width = |key: &str| {
        els.iter()
            .find(|e| e.key.as_deref() == Some(key))
            .unwrap()
            .rect[2]
    };
    assert!(width("t-synthetic-channel") <= 240.0 && width("t-synthetic-channel") >= 72.0);
    assert!(els.iter().any(|e| e.label.as_deref() == Some("Close tab")));
    assert!(els.iter().any(|e| e.key.as_deref() == Some("icon")));
}

fn drag_tab(rt: &mut Runtime<State>, from: &str, to: &str) {
    rt.invalidate();
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
    }
    let (x, y) = rt.find(from).unwrap();
    let (tx, _) = rt.find(to).unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    let steps = 12;
    for i in 1..=steps {
        rt.pointer_move(x + (tx - x) * i as f32 / steps as f32, y);
        rt.frame(1.0 / 60.0);
    }
    rt.pointer_up(tx, y);
    rt.frame(1.0 / 60.0);
    rt.invalidate();
    rt.frame(0.0);
}

#[test]
fn dragging_a_tab_reorders_and_keeps_the_order() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-channel", "synthetic-other"]
    );
    drag_tab(&mut rt, "t-synthetic-channel", "t-synthetic-other");
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-other", "synthetic-channel"]
    );
    assert_eq!(tab_keys(&rt), ["t-synthetic-other", "t-synthetic-channel"]);
}

#[test]
fn dragging_the_preview_tab_keeps_it_where_it_was_dropped() {
    let mut rt = synthetic_runtime();
    rt.state.preview = Some("synthetic-other".into());
    rt.state.preview_at = 1;
    drag_tab(&mut rt, "t-synthetic-other", "t-synthetic-channel");
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-other", "synthetic-channel"]
    );
    assert_eq!(tab_keys(&rt), ["t-synthetic-other", "t-synthetic-channel"]);
}

#[test]
fn preview_tab_made_durable_keeps_its_dragged_position() {
    let mut rt = synthetic_runtime();
    rt.state.preview = Some("synthetic-other".into());
    rt.state.preview_at = 0;
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-other", "synthetic-channel"]
    );
    rt.state.keep_tab("synthetic-other");
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-other", "synthetic-channel"]
    );
}
