use antimatter::{
    SessionScope,
    accounts::{self, Account, AccountKey, Draft, Navigation, Persistence},
    conversation::{self, Intent, Pending, Update},
    mattermost::{self, Channel, Post, Secret, ServerOrigin},
    websocket,
};
use rune::tok::{self, motion, type_};
use rune::{AppHandle, AppSpec, Cx, El, TextEdit, col, el, text, text_input};
use std::sync::Arc;
use tokio::sync::mpsc;

const COMPOSER: &str = "conversation";
// ponytail: a reserved pane retains unresolved submissions, not resendable drafts.
// Upgrade to a versioned pending record with identity/recovery when the worker supports it.
const SUBMITTED: &str = "conversation-pending";

#[derive(Clone)]
enum AfterCheckpoint {
    Save,
    Disconnect,
    Select(AccountKey),
    SignOut(AccountKey),
    Send(String),
    Load(String),
    Acknowledge,
    Rollback,
}

enum Login {
    Pat(ServerOrigin, Secret),
    Password(ServerOrigin, String, Secret),
    Saved(AccountKey),
    #[cfg(target_os = "macos")]
    Saml(mattermost::SamlAttempt, antimatter::macos::BrowserCallback),
}

struct State {
    epoch: u64,
    persistence: Option<Persistence>,
    accounts: Vec<Account>,
    selected: Option<AccountKey>,
    durable: Option<AccountKey>,
    authenticated: Option<AccountKey>,
    auth_writing: bool,
    auth_task: Option<tokio::task::JoinHandle<()>>,
    write_task: Option<tokio::task::JoinHandle<()>>,
    checkpoint_pending: Option<(AfterCheckpoint, Vec<Draft>, Navigation)>,
    drafts: Vec<Draft>,
    navigation: Navigation,
    committed_navigation: Navigation,
    remember: bool,
    submitted: bool,
    recovered_pending: bool,
    checkpoint_retry: Option<AfterCheckpoint>,
    #[cfg(target_os = "macos")]
    browser: Option<antimatter::macos::BrowserSession>,
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
            submitted: false,
            recovered_pending: false,
            checkpoint_retry: None,
            #[cfg(target_os = "macos")]
            browser: None,
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
        if self.auth_writing || self.busy && self.write_task.is_some() {
            return;
        }
        self.epoch += 1;
        self.scope.cancel();
        #[cfg(target_os = "macos")]
        {
            self.browser = None;
        }
        self.durable = None;
        self.authenticated = None;
        self.checkpoint_retry = None;
        self.checkpoint_pending = None;
        self.drafts.clear();
        self.navigation = Navigation::default();
        self.committed_navigation = Navigation::default();
        self.submitted = false;
        self.recovered_pending = false;
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

    fn autosave(&mut self) {
        if self.durable.is_some()
            && !self.busy
            && !self.submitted
            && !self.recovered_pending
            && self.pending.is_none()
            && self.checkpoint_retry.is_none()
            && (self.snapshot() != self.drafts || self.navigation != self.committed_navigation)
        {
            self.checkpoint(AfterCheckpoint::Save);
        }
    }

    fn close(&mut self) {
        self.autosave();
        if self.auth_writing
            && let (Some(task), Some(runtime)) = (self.auth_task.take(), self.runtime.clone())
        {
            let _ = runtime.block_on(task);
        }
        if let (Some(task), Some(runtime)) = (self.write_task.take(), self.runtime.clone()) {
            let _ = runtime.block_on(task);
        }
        self.epoch += 1;
        if let Some((AfterCheckpoint::Send(_), drafts, navigation)) = self.checkpoint_pending.take()
            && let (Some(store), Some(key), Some(runtime)) = (
                self.persistence.clone(),
                self.durable.clone(),
                self.runtime.clone(),
            )
        {
            if runtime
                .block_on(store.checkpoint(key, drafts.clone(), navigation.clone()))
                .is_ok()
            {
                self.drafts = drafts;
                self.committed_navigation = navigation;
            } else {
                self.error = Some("Draft rollback failed. Retry before leaving.");
                eprintln!("Draft rollback failed; unsent content is not confirmed saved.");
            }
        }
        // ponytail: Rune cannot veto close. Disk failure/crash before autosave commits
        // retains only the last durable edit; upgrade to a quit-confirmation API.
    }

    fn connect(&mut self, password: bool) {
        if self.busy || self.auth_writing || self.synthetic || self.account.is_some() {
            return;
        }
        let value = if password {
            std::mem::take(&mut self.password.text)
        } else {
            std::mem::take(&mut self.pat.text)
        };
        self.password.clear();
        self.pat.clear();
        let origin = ServerOrigin::new(
            &self.server.text,
            std::env::args().any(|a| a == "--dev-http"),
        );
        let (Ok(origin), Ok(token)) = (origin, Secret::new(value)) else {
            self.error = Some("Enter a valid server and credential.");
            return;
        };
        self.authenticate(if password {
            Login::Password(origin, self.login.text.clone(), token)
        } else {
            Login::Pat(origin, token)
        });
    }

    #[cfg(target_os = "macos")]
    fn saml(&mut self) {
        if self.busy || self.auth_writing || self.synthetic || self.account.is_some() {
            return;
        }
        let Ok(origin) = ServerOrigin::new(
            &self.server.text,
            std::env::args().any(|a| a == "--dev-http"),
        ) else {
            self.error = Some("Enter a valid server.");
            return;
        };
        let attempt = mattermost::SamlAttempt::new(origin, self.epoch + 1);
        match antimatter::macos::BrowserSession::start_for_app(&attempt.login_url()) {
            Ok((browser, callback)) => {
                self.browser = Some(browser);
                self.authenticate(Login::Saml(attempt, callback));
            }
            Err(_) => {
                self.error =
                    Some("Browser sign-in requires the registered native app bundle and a window.")
            }
        }
    }

    fn authenticate(&mut self, login: Login) {
        if self.busy || self.auth_writing || self.synthetic || self.account.is_some() {
            return;
        }
        let (Some(runtime), Some(handle)) = (self.runtime.clone(), self.handle.clone()) else {
            return;
        };
        let persistence = self.persistence.clone();
        let remember = self.remember;
        if remember && persistence.is_none() {
            self.error =
                Some("Account storage unavailable. Disable Remember for a session-only sign-in.");
            return;
        }
        let (generation, mut stop) = self.scope.replace();
        self.epoch += 1;
        let login_epoch = self.epoch;
        self.busy = true;
        self.error = None;
        let worker_runtime = runtime.clone();
        self.auth_task = Some(runtime.spawn(async move {
            let result = authenticate(
                login,
                persistence,
                remember,
                login_epoch,
                Some((handle.clone(), generation, stop.clone())),
            )
            .await;
            let session = match result {
                Ok(session) => session,
                Err(error) => {
                    handle.update(move |s, _| {
                        if s.scope.accepts(generation) {
                            s.busy = false;
                            s.auth_writing = false;
                            s.auth_task = None;
                            s.error = Some(error);
                            #[cfg(target_os = "macos")]
                            {
                                s.browser = None;
                            }
                        }
                    });
                    return;
                }
            };
            let (client, user, authenticated, key, saved, drafts, navigation) = session;
            let account = format!("{} · {}", client.origin().as_str(), user.username);
            let (intents_tx, intents_rx) = mpsc::channel(32);
            let (socket_tx, socket_rx) = mpsc::channel(64);
            let (updates_tx, mut updates_rx) = mpsc::channel(64);
            handle.update(move |s, _| {
                if s.scope.accepts(generation) {
                    s.account = Some(account);
                    s.authenticated = Some(authenticated);
                    s.auth_writing = false;
                    s.auth_task = None;
                    s.durable = key;
                    if let Some(saved) = saved {
                        s.accounts = saved;
                    }
                    if s.durable.is_some() {
                        s.selected = s.durable.clone();
                    }
                    s.drafts = drafts;
                    s.committed_navigation = navigation.clone();
                    s.navigation = navigation;
                    s.recovered_pending = s.drafts.iter().any(|d| d.pane_id == SUBMITTED);
                    s.intents = Some(intents_tx);
                    s.busy = false;
                    #[cfg(target_os = "macos")]
                    {
                        s.browser = None;
                    }
                    s.dispatch(Intent::Refresh);
                }
            });
            worker_runtime.spawn(async move {
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
        }));
    }

    fn blocked(&mut self) -> bool {
        if self.busy
            || self.checkpoint_retry.is_some()
            || self.submitted
            || self.pending.is_some()
            || self.recovered_pending
        {
            self.error = Some(
                "Wait for pending delivery and durable writes before switching or signing out.",
            );
            true
        } else {
            false
        }
    }

    fn snapshot(&self) -> Vec<Draft> {
        let mut drafts = self.drafts.clone();
        if self.recovered_pending {
            return drafts;
        }
        if let Some(channel) = &self.channel {
            drafts.retain(|d| !(d.pane_id == COMPOSER && &d.channel_id == channel));
            if !self.draft.text.is_empty()
                && !drafts
                    .iter()
                    .any(|d| d.pane_id == SUBMITTED && &d.channel_id == channel)
            {
                drafts.push(Draft {
                    pane_id: COMPOSER.into(),
                    channel_id: channel.clone(),
                    text: self.draft.text.clone(),
                });
            }
        }
        drafts
    }

    fn checkpoint(&mut self, action: AfterCheckpoint) {
        if !matches!(
            action,
            AfterCheckpoint::Acknowledge | AfterCheckpoint::Rollback
        ) && self.blocked()
        {
            return;
        }
        let Some(key) = self.durable.clone() else {
            self.finish_checkpoint(action, self.snapshot(), None);
            return;
        };
        let (Some(store), Some(runtime), Some(handle)) = (
            self.persistence.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            self.checkpoint_retry = Some(action);
            self.error =
                Some("Draft storage unavailable. UNSAVED content retained; retry before closing.");
            return;
        };
        let original_drafts = self.snapshot();
        let mut drafts = original_drafts.clone();
        if matches!(action, AfterCheckpoint::Send(_)) {
            for draft in &mut drafts {
                if draft.pane_id == COMPOSER && Some(&draft.channel_id) == self.channel.as_ref() {
                    draft.pane_id = SUBMITTED.into();
                }
            }
        } else if matches!(action, AfterCheckpoint::Rollback) {
            for draft in &mut drafts {
                if draft.pane_id == SUBMITTED && Some(&draft.channel_id) == self.channel.as_ref() {
                    draft.pane_id = COMPOSER.into();
                }
            }
        } else if matches!(action, AfterCheckpoint::Acknowledge) {
            drafts.retain(|d| {
                !(matches!(d.pane_id.as_str(), COMPOSER | SUBMITTED)
                    && Some(&d.channel_id) == self.channel.as_ref())
            });
        }
        let navigation = Navigation {
            channel_id: self
                .channel
                .clone()
                .or_else(|| self.navigation.channel_id.clone()),
        };
        self.checkpoint_pending = Some((action.clone(), original_drafts, navigation.clone()));
        let epoch = self.epoch;
        self.busy = true;
        if matches!(action, AfterCheckpoint::Send(_)) {
            self.drafts = drafts.clone();
        }
        self.write_task = Some(runtime.spawn(async move {
            let result = async {
                store.checkpoint(key, drafts.clone(), navigation).await?;
                match &action {
                    AfterCheckpoint::Select(key) => {
                        store.select(Some(key.clone())).await?;
                        Ok(None)
                    }
                    AfterCheckpoint::SignOut(key) => store.sign_out(key.clone()).await.map(Some),
                    _ => Ok(None),
                }
            }
            .await;
            if result.is_err() {
                eprintln!("Durable update failed; latest content is not confirmed saved.");
            }
            handle.update(move |s, _| {
                if s.epoch != epoch {
                    return;
                }
                s.complete_checkpoint(action, drafts, result);
            });
        }));
    }

    fn complete_checkpoint(
        &mut self,
        action: AfterCheckpoint,
        drafts: Vec<Draft>,
        result: accounts::Result<Option<Vec<Account>>>,
    ) {
        self.busy = false;
        self.write_task = None;
        match result {
            Ok(accounts) => self.finish_checkpoint(action, drafts, accounts),
            Err(_) => {
                self.checkpoint_pending = None;
                if matches!(action, AfterCheckpoint::Send(_)) {
                    self.checkpoint(AfterCheckpoint::Rollback);
                    return;
                }
                self.checkpoint_retry = Some(action);
                self.error = Some("Durable update failed. Content retained; retry before leaving.");
            }
        }
    }

    fn finish_checkpoint(
        &mut self,
        action: AfterCheckpoint,
        drafts: Vec<Draft>,
        accounts: Option<Vec<Account>>,
    ) {
        self.drafts = drafts;
        if let Some((_, _, navigation)) = self.checkpoint_pending.take() {
            self.committed_navigation = navigation;
        }
        self.checkpoint_retry = None;
        self.error = None;
        match action {
            AfterCheckpoint::Save => (),
            AfterCheckpoint::Rollback => {
                self.recovered_pending = false;
                self.error = Some("Send was not queued. Draft saved; try Send again.");
            }
            AfterCheckpoint::Disconnect => self.clear_session(),
            AfterCheckpoint::Select(key) => {
                self.clear_session();
                self.selected = Some(key);
            }
            AfterCheckpoint::SignOut(key) => {
                self.clear_session();
                if self.selected.as_ref() == Some(&key) {
                    self.selected = None;
                }
                if let Some(accounts) = accounts {
                    self.accounts = accounts;
                }
            }
            AfterCheckpoint::Send(message) => {
                if self.dispatch(Intent::Send(message)) {
                    self.submitted = true;
                    self.ready = false;
                } else if self.durable.is_some() {
                    self.checkpoint(AfterCheckpoint::Rollback);
                }
            }
            AfterCheckpoint::Load(channel) => self.load_now(channel),
            AfterCheckpoint::Acknowledge => {
                self.draft.clear();
                self.submitted = false;
                self.recovered_pending = false;
                self.checkpoint_retry = None;
            }
        }
    }

    fn select_account(&mut self, key: AccountKey) {
        if self.blocked() {
            return;
        }
        if self.durable.is_some() {
            self.checkpoint(AfterCheckpoint::Select(key));
            return;
        }
        let (Some(store), Some(runtime), Some(handle)) = (
            self.persistence.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            return;
        };
        self.busy = true;
        let epoch = self.epoch;
        self.write_task = Some(runtime.spawn(async move {
            let result = store.select(Some(key.clone())).await;
            handle.update(move |s, _| {
                if s.epoch == epoch {
                    s.busy = false;
                    s.write_task = None;
                    if result.is_ok() {
                        s.clear_session();
                        s.selected = Some(key);
                    } else {
                        s.error = Some("Could not select account. Content retained.");
                    }
                }
            });
        }));
    }

    fn sign_out(&mut self, key: AccountKey) {
        if self.blocked() {
            return;
        }
        if self.durable.is_some() {
            self.checkpoint(AfterCheckpoint::SignOut(key));
            return;
        }
        let (Some(store), Some(runtime), Some(handle)) = (
            self.persistence.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            return;
        };
        self.busy = true;
        let epoch = self.epoch;
        self.write_task = Some(runtime.spawn(async move {
            let result = store.sign_out(key.clone()).await;
            handle.update(move |s, _| {
                if s.epoch != epoch {
                    return;
                }
                s.write_task = None;
                s.complete_sign_out(key, result);
            });
        }));
    }

    fn complete_sign_out(&mut self, key: AccountKey, result: accounts::Result<Vec<Account>>) {
        self.busy = false;
        match result {
            Ok(accounts) => {
                if self.authenticated.as_ref() == Some(&key) {
                    self.clear_session();
                }
                self.accounts = accounts;
                if self.selected.as_ref() == Some(&key) {
                    self.selected = None;
                }
            }
            Err(_) => {
                self.error = Some(
                    "Sign-out failed; saved state may be partially removed. Retry or sign in again.",
                )
            }
        }
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
        if !self.ready
            || self.busy
            || self.submitted
            || self.pending.is_some()
            || self.recovered_pending
            || (self.durable.is_none() && !self.draft.text.is_empty())
        {
            return;
        }
        if self.durable.is_some() {
            self.checkpoint(AfterCheckpoint::Load(channel));
        } else {
            self.load_now(channel);
        }
    }

    fn load_now(&mut self, channel: String) {
        if self.dispatch(Intent::Load(channel.clone())) {
            self.channel = Some(channel.clone());
            self.navigation.channel_id = Some(channel.clone());
            self.draft = TextEdit::new(
                self.drafts
                    .iter()
                    .find(|d| d.pane_id == COMPOSER && d.channel_id == channel)
                    .map_or("", |d| d.text.as_str()),
            );
            self.posts.clear();
            self.ready = false;
            self.error = None;
        }
    }

    fn send(&mut self) {
        if !self.ready
            || self.busy
            || self.submitted
            || self.recovered_pending
            || self.pending.is_some()
            || self.channel.is_none()
            || self.draft.text.trim().is_empty()
        {
            return;
        }
        self.checkpoint(AfterCheckpoint::Send(self.draft.text.clone()));
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
                    if self.durable.is_some() {
                        self.checkpoint(AfterCheckpoint::Acknowledge);
                    } else {
                        self.draft.clear();
                        self.submitted = false;
                    }
                }
                self.pending = pending;
            }
            Update::Ready(ready) => {
                self.ready = ready;
                if ready
                    && self.channel.is_none()
                    && let Some(channel) = self
                        .navigation
                        .channel_id
                        .clone()
                        .filter(|id| self.channels.iter().any(|c| &c.id == id))
                {
                    self.load_now(channel);
                }
            }
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

fn validate_identity(
    expected: Option<&AccountKey>,
    actual: &AccountKey,
) -> Result<(), &'static str> {
    if expected.is_some_and(|expected| expected != actual) {
        Err("Saved credential belongs to a different user. No account was adopted or changed.")
    } else {
        Ok(())
    }
}

type Authenticated = (
    mattermost::Client,
    mattermost::User,
    AccountKey,
    Option<AccountKey>,
    Option<Vec<Account>>,
    Vec<Draft>,
    Navigation,
);

async fn authenticate(
    login: Login,
    store: Option<Persistence>,
    remember: bool,
    _generation: u64,
    gate: Option<(AppHandle<State>, u64, tokio::sync::watch::Receiver<bool>)>,
) -> Result<Authenticated, &'static str> {
    let mut drafts = vec![];
    let mut navigation = Navigation::default();
    let mut expected = None;
    let login_request = async {
        let result = match login {
            Login::Pat(origin, token) => mattermost::sign_in_pat(origin, token).await,
            Login::Password(origin, login, token) => {
                mattermost::sign_in_password(origin, &login, token).await
            }
            Login::Saved(key) => {
                let store = store.as_ref().ok_or("Account storage unavailable.")?;
                let (token, saved_drafts, saved_navigation) =
                    store.restore(key.clone()).await.map_err(
                        |_| "Saved sign-in unavailable. Sign in again; existing state is retained.",
                    )?;
                drafts = saved_drafts;
                navigation = saved_navigation;
                let origin =
                    ServerOrigin::new(key.origin(), std::env::args().any(|a| a == "--dev-http"))
                        .map_err(
                            |_| "Saved server is invalid or requires development HTTP opt-in.",
                        )?;
                expected = Some(key);
                mattermost::sign_in_pat(origin, token).await
            }
            #[cfg(target_os = "macos")]
            Login::Saml(mut attempt, callback) => {
                let callback = callback
                    .await
                    .map_err(|_| "Browser sign-in cancelled.")?
                    .map_err(|_| "Browser sign-in cancelled or failed.")?;
                let url = url::Url::parse(&callback).map_err(|_| "Invalid browser callback.")?;
                attempt.sign_in(&url, _generation).await
            }
        };
        result.map_err(|_| "Sign-in failed. Check the server and credentials.")
    };
    let result = if let Some((_, _, stop)) = &gate {
        let mut stop = stop.clone();
        tokio::select! {
            _ = stop.changed() => return Err("Sign-in cancelled before persistence."),
            result = login_request => result,
        }
    } else {
        login_request.await
    };
    let (client, user) = result?;
    let key = AccountKey::new(client.origin(), &user).map_err(|_| "Invalid signed-in identity.")?;
    validate_identity(expected.as_ref(), &key)?;
    let mut saved = None;
    let durable = if expected.is_some() || remember {
        let store = store.as_ref().ok_or("Account storage unavailable.")?;
        if let Some((handle, generation, _)) = gate {
            let (tx, rx) = tokio::sync::oneshot::channel();
            handle.update(move |s, _| {
                let accepted = s.scope.accepts(generation);
                if accepted {
                    s.auth_writing = true;
                }
                let _ = tx.send(accepted);
            });
            if !rx.await.unwrap_or(false) {
                return Err("Sign-in cancelled before persistence.");
            }
        }
        if remember && expected.is_none() {
            let (accounts, saved_drafts, saved_navigation) = store
                .save(
                    key.clone(),
                    user.username.clone(),
                    client.credential_for_persistence(),
                )
                .await
                .map_err(|_| "Could not remember sign-in. Existing account state retained.")?;
            saved = Some(accounts);
            drafts = saved_drafts;
            navigation = saved_navigation;
        }
        store
            .select(Some(key.clone()))
            .await
            .map_err(|_| "Could not select saved account. Retry connection.")?;
        Some(key.clone())
    } else {
        None
    };
    Ok((client, user, key, durable, saved, drafts, navigation))
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
                text(if s.durable.is_some() {
                    if s.checkpoint_retry.is_some() { "UNSAVED: retry durable update before closing. Closing cannot be blocked; failed writes lose the latest edits." }
                    else if s.busy { "Saving durable state… wait before closing. Accepted writes cannot be cancelled or rolled back." }
                    else { "Drafts autosave after edits. A crash or failed write can lose the latest edit. Pending delivery blocks switching/sign-out." }
                } else { "Session-only: closing/disconnecting discards drafts. Use Remember for durable autosave." })
                    .color(t.text),
            )
            .child(button("disconnect", "Disconnect session", s.busy || s.submitted || s.pending.is_some() || s.recovered_pending, |s| {
                s.checkpoint(AfterCheckpoint::Disconnect)
            }))
            .child(button(
                "reload",
                "Reload",
                s.busy || (!s.ready && s.error.is_none()),
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
                !s.ready
                    || s.busy
                    || s.submitted
                    || s.recovered_pending
                    || s.pending.is_some()
                    || (s.durable.is_none() && !s.draft.text.is_empty()),
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
            .child(
                if !s.ready || s.busy || s.submitted || s.recovered_pending || s.pending.is_some() {
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
                },
            )
            .child(button(
                "send",
                "Send",
                !s.ready
                    || s.busy
                    || s.submitted
                    || s.recovered_pending
                    || s.pending.is_some()
                    || s.channel.is_none()
                    || s.draft.text.trim().is_empty(),
                |s| s.send(),
            ));
        if s.durable.is_some() {
            body = body.child(button(
                "save-draft",
                "Save draft",
                s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
                |s| s.checkpoint(AfterCheckpoint::Save),
            ));
        }
        if s.recovered_pending {
            body = body.child(text("Unresolved durable submission. Text is retained below and cannot be resent, switched or signed out; delivery recovery requires manual verification.").color(t.text));
            for draft in s.drafts.iter().filter(|d| d.pane_id == SUBMITTED) {
                body =
                    body.child(text(format!("{}: {}", draft.channel_id, draft.text)).color(t.text));
            }
        }
        if s.checkpoint_retry.is_some() {
            body = body.child(button(
                "retry-save",
                "Retry durable update (does not resend)",
                s.busy,
                |s| {
                    if let Some(action) = s.checkpoint_retry.take() {
                        s.checkpoint(action);
                    }
                },
            ));
        }
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
                    s.busy || !pending.failed || !s.ready,
                    |s| {
                        if s.dispatch(Intent::Retry) {
                            s.ready = false;
                        }
                    },
                ));
        }
    } else {
        body = body
            .child(text("Sign in explicitly · Remember is opt-in").color(t.text))
            .child(button(
                "remember",
                if s.remember {
                    "Remember sign-in: on"
                } else {
                    "Remember sign-in: off"
                },
                s.busy,
                |s| s.remember = !s.remember,
            ))
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
    #[cfg(target_os = "macos")]
    if s.account.is_none() {
        body = body.child(button(
            "connect-saml",
            "Connect in system browser",
            s.busy || s.synthetic,
            |s| s.saml(),
        ));
        if s.busy && s.browser.is_some() {
            body = body.child(button(
                "cancel-login",
                "Cancel browser sign-in",
                s.auth_writing,
                |s| s.clear_session(),
            ));
        }
    }
    if !s.accounts.is_empty() {
        body = body.child(text("Saved accounts · selection does not connect").color(t.text));
        for account in &s.accounts {
            let key = account.key.clone();
            body = body.child(button(
                &format!("account-{}", account.local_id),
                &format!(
                    "{} · {}{}",
                    account.key.origin(),
                    account.username,
                    if s.selected.as_ref() == Some(&account.key) {
                        " · selected"
                    } else {
                        ""
                    }
                ),
                s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
                move |s| s.select_account(key.clone()),
            ));
        }
        if let Some(key) = &s.selected {
            let connect = key.clone();
            let signout = key.clone();
            body = body
                .child(button(
                    "connect-saved",
                    "Connect selected saved account",
                    s.account.is_some() || s.busy || s.synthetic,
                    move |s| s.authenticate(Login::Saved(connect.clone())),
                ))
                .child(button(
                    "sign-out",
                    "Sign out selected account (delete saved state)",
                    s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
                    move |s| s.sign_out(signout.clone()),
                ));
        }
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
            state.handle = Some(handle.clone());
            state.busy = true;
            state.runtime.as_ref().unwrap().spawn(async move {
                let result = async {
                    let root = accounts::AccountStore::<accounts::KeychainCredentials>::default_root()?;
                    let store = Persistence::open(root, accounts::KeychainCredentials::default()).await?;
                    let accounts = store.accounts().await?;
                    let selected = store.selected().await?;
                    Ok::<_, accounts::Error>((store, accounts, selected))
                }.await;
                handle.update(move |s, _| {
                    s.busy = false;
                    match result {
                        Ok((store, accounts, selected)) => { s.persistence = Some(store); s.accounts = accounts; s.selected = selected; }
                        Err(_) => s.error = Some("Could not open saved account storage. Existing state retained; session-only sign-in is available."),
                    }
                });
            });
        }
        state
    })
    .turn_scope(|_| {}, State::autosave)
    .on_close(|s, _| s.close())
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
        rt.state.handle = Some(
            rune::App::new(AppSpec::new("test", (640.0, 800.0), State::default, view)).handle(),
        );
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
