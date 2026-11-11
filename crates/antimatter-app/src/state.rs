use antimatter_services::{
    SessionScope,
    accounts::{Account, AccountKey, Draft, Navigation, Persistence},
    conversation::{Intent, Pending, Unread},
    mattermost::{self, Channel, Post, Secret, ServerOrigin},
    websocket,
};
use rune::PointerPress;
use rune::{AppHandle, TextEdit};
use rune_kit::{PaneState, shell::TabDragState};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::mpsc;

pub(crate) const COMPOSER: &str = "conversation";
pub(crate) const WORKSPACE_WINDOW_SIZE: (f32, f32) = (1180.0, 760.0);
// ponytail: a reserved pane retains unresolved submissions, not resendable drafts.
// Upgrade to a versioned pending record with identity/recovery when the worker supports it.
pub(crate) const SUBMITTED: &str = "conversation-pending";

#[derive(Clone)]
pub(crate) enum AfterCheckpoint {
    Save,
    Disconnect,
    Select(AccountKey),
    SignOut(AccountKey),
    Send(String),
    Load(String),
    Acknowledge,
    Rollback,
}

pub(crate) enum Login {
    Pat(ServerOrigin, Secret),
    Password(ServerOrigin, String, Secret),
    Saved(AccountKey),
    #[cfg(target_os = "macos")]
    Saml(
        mattermost::SamlAttempt,
        antimatter_services::macos::BrowserCallback,
    ),
}

pub(crate) struct State {
    pub(crate) epoch: u64,
    pub(crate) persistence: Option<Persistence>,
    pub(crate) accounts: Vec<Account>,
    pub(crate) selected: Option<AccountKey>,
    pub(crate) durable: Option<AccountKey>,
    pub(crate) authenticated: Option<AccountKey>,
    pub(crate) auth_writing: bool,
    pub(crate) auth_task: Option<tokio::task::JoinHandle<()>>,
    pub(crate) write_task: Option<tokio::task::JoinHandle<()>>,
    pub(crate) checkpoint_pending: Option<(AfterCheckpoint, Vec<Draft>, Navigation)>,
    pub(crate) drafts: Vec<Draft>,
    pub(crate) navigation: Navigation,
    pub(crate) committed_navigation: Navigation,
    pub(crate) remember: bool,
    pub(crate) method: usize,
    pub(crate) submitted: bool,
    pub(crate) recovered_pending: bool,
    pub(crate) checkpoint_retry: Option<AfterCheckpoint>,
    #[cfg(target_os = "macos")]
    pub(crate) browser: Option<antimatter_services::macos::BrowserSession>,
    pub(crate) on: bool,
    pub(crate) auth_proof: bool,
    pub(crate) application: bool,
    pub(crate) theme: antimatter_theme::Theme,
    pub(crate) synthetic: bool,
    pub(crate) sidebar: PaneState,
    pub(crate) preview: Option<String>,
    pub(crate) preview_at: usize,
    pub(crate) tab_drag: TabDragState,
    pub(crate) tab_menu: Option<(String, PointerPress)>,
    pub(crate) pat: TextEdit,
    pub(crate) password: TextEdit,
    pub(crate) server: TextEdit,
    pub(crate) login: TextEdit,
    pub(crate) draft: TextEdit,
    pub(crate) raw: bool,
    pub(crate) source: TextEdit,
    pub(crate) handle: Option<AppHandle<State>>,
    pub(crate) runtime: Option<Arc<tokio::runtime::Runtime>>,
    pub(crate) scope: SessionScope,
    pub(crate) intents: Option<mpsc::Sender<Intent>>,
    pub(crate) account: Option<String>,
    pub(crate) channel: Option<String>,
    pub(crate) channels: Vec<Channel>,
    pub(crate) unread: HashMap<String, Unread>,
    pub(crate) posts: Vec<Post>,
    pub(crate) pending: Option<Pending>,
    pub(crate) ready: bool,
    pub(crate) busy: bool,
    pub(crate) connection: websocket::State,
    pub(crate) error: Option<&'static str>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            epoch: 0,
            persistence: None,
            accounts: vec![],
            selected: None,
            durable: None,
            authenticated: None,
            auth_writing: false,
            auth_task: None,
            write_task: None,
            checkpoint_pending: None,
            drafts: vec![],
            navigation: Navigation::default(),
            committed_navigation: Navigation::default(),
            remember: false,
            method: 0,
            submitted: false,
            recovered_pending: false,
            checkpoint_retry: None,
            #[cfg(target_os = "macos")]
            browser: None,
            on: false,
            auth_proof: false,
            application: false,
            theme: antimatter_theme::Theme::Default,
            synthetic: false,
            sidebar: PaneState::new(248.0).range(160.0, 420.0),
            preview: None,
            preview_at: 0,
            tab_drag: TabDragState::new(),
            tab_menu: None,
            pat: TextEdit::default().secure(),
            password: TextEdit::default().secure(),
            server: TextEdit::default(),
            login: TextEdit::default(),
            draft: crate::markdown::editor(TextEdit::default().rich()),
            raw: false,
            source: TextEdit::default(),
            handle: None,
            runtime: None,
            scope: SessionScope::default(),
            intents: None,
            account: None,
            channel: None,
            channels: vec![],
            unread: HashMap::new(),
            posts: vec![],
            pending: None,
            ready: false,
            busy: false,
            connection: websocket::State::Idle,
            error: None,
        }
    }
}
