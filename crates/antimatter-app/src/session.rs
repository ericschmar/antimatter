use crate::auth::*;
use crate::state::*;
use antimatter_services::{
    accounts::{self, Account, AccountKey, Navigation},
    conversation::{self, Intent},
    mattermost::{self, Secret, ServerOrigin},
    websocket,
};
use tokio::sync::mpsc;

impl State {
    pub(crate) fn clear_session(&mut self) {
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
        self.preview = None;
        self.tab_menu = None;
        self.submitted = false;
        self.recovered_pending = false;
        self.intents = None;
        self.account = None;
        self.channel = None;
        self.channels.clear();
        self.unread.clear();
        self.posts.clear();
        self.pending = None;
        self.clear_draft();
        self.ready = false;
        self.busy = false;
        self.connection = websocket::State::Idle;
        self.error = None;
    }

    pub(crate) fn connect(&mut self, password: bool) {
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
    pub(crate) fn saml(&mut self) {
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
        match antimatter_services::macos::BrowserSession::start_for_app(&attempt.login_url()) {
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

    pub(crate) fn authenticate(&mut self, login: Login) {
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
            handle.update(move |s, tx| {
                if s.scope.accepts(generation) {
                    tx.resize_window(WORKSPACE_WINDOW_SIZE);
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

    pub(crate) fn select_account(&mut self, key: AccountKey) {
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

    pub(crate) fn sign_out(&mut self, key: AccountKey) {
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

    pub(crate) fn complete_sign_out(
        &mut self,
        key: AccountKey,
        result: accounts::Result<Vec<Account>>,
    ) {
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
}
