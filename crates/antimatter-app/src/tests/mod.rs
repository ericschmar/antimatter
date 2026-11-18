mod network;
mod persistence;
mod ui;

use crate::auth::*;
use crate::scenes::synthetic_workspace;
use crate::state::*;
use crate::view::view;
use antimatter_services::{
    accounts::{self, AccountKey, Draft, LoginMethod, Navigation, Persistence},
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
            members: Vec::new(),
            last_post_at: 0,
            muted: false,
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
            file_ids: vec![],
            root_id: String::new(),
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
        root_id: String::new(),
        metadata: Default::default(),
    }
}

async fn next(updates: &mut mpsc::Receiver<Update>) -> Update {
    tokio::time::timeout(Duration::from_secs(3), updates.recv())
        .await
        .unwrap()
        .unwrap()
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
