use antimatter_services::{
    SessionScope,
    accounts::{Account, AccountKey, Draft, LoginMethod, Navigation, Persistence},
    conversation::{Intent, Pending, ThreadPreview, Unread},
    mattermost::{self, Channel, Post, Secret, ServerOrigin},
    settings::MessageSpacing,
    websocket,
};
use rune::PointerPress;
use rune::{AppHandle, TextEdit};
use rune_kit::{PaneState, shell::TabDragState};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32},
    },
};
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
    SignOut(AccountKey),
    Send(String),
    Load(String),
    Acknowledge,
    Rollback,
}

pub(crate) enum Login {
    Pat(ServerOrigin, Secret, Option<AccountKey>, LoginMethod),
    Password(
        ServerOrigin,
        String,
        Secret,
        Option<AccountKey>,
        LoginMethod,
    ),
    Saved(AccountKey),
    #[cfg(target_os = "macos")]
    Saml(
        mattermost::SamlAttempt,
        antimatter_services::macos::BrowserCallback,
        Option<AccountKey>,
        LoginMethod,
    ),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum NewKind {
    Channel,
    Dm,
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
    pub(crate) accent: antimatter_services::settings::AccentColor,
    pub(crate) message_font_size: u8,
    pub(crate) message_spacing: MessageSpacing,
    pub(crate) show_timeline_avatars: bool,
    pub(crate) synthetic: bool,
    pub(crate) sidebar: PaneState,
    pub(crate) channels_collapsed: bool,
    pub(crate) favorites_collapsed: bool,
    pub(crate) archived_collapsed: bool,
    pub(crate) dms_collapsed: bool,
    pub(crate) server_open: bool,
    pub(crate) last_active: Option<std::time::Instant>,
    pub(crate) new_menu: bool,
    pub(crate) new_dialog: Option<NewKind>,
    pub(crate) new_name: TextEdit,
    pub(crate) new_error: Option<String>,
    pub(crate) new_busy: bool,
    pub(crate) team_ids: Vec<String>,
    pub(crate) preview: Option<String>,
    pub(crate) preview_at: usize,
    pub(crate) tab_drag: TabDragState,
    pub(crate) tab_menu: Option<(String, PointerPress)>,
    pub(crate) channel_menu: Option<(String, PointerPress)>,
    pub(crate) image_menu: Option<String>,
    pub(crate) saved_account_menu: Option<(AccountKey, PointerPress)>,
    pub(crate) editing_account: Option<AccountKey>,
    pub(crate) search: TextEdit,
    pub(crate) search_busy: bool,
    pub(crate) attachments: Vec<std::path::PathBuf>,
    pub(crate) reply_to: Option<antimatter_services::mattermost::Post>,
    pub(crate) previews: HashMap<String, Option<antimatter_services::preview::Preview>>,
    pub(crate) emoji_picker: Option<String>,
    pub(crate) emoji_query: TextEdit,
    pub(crate) emoji_tab: Option<emojis::Group>,
    pub(crate) custom_emoji: Vec<String>,
    pub(crate) search_results: Option<Vec<antimatter_services::mattermost::Post>>,
    pub(crate) pat: TextEdit,
    pub(crate) password: TextEdit,
    pub(crate) server: TextEdit,
    pub(crate) login: TextEdit,
    pub(crate) draft: TextEdit,
    pub(crate) raw: bool,
    pub(crate) caret_on: bool,
    pub(crate) source: TextEdit,
    pub(crate) handle: Option<AppHandle<State>>,
    pub(crate) runtime: Option<Arc<tokio::runtime::Runtime>>,
    pub(crate) scope: SessionScope,
    pub(crate) intents: Option<mpsc::Sender<Intent>>,
    pub(crate) account: Option<String>,
    pub(crate) channel: Option<String>,
    pub(crate) channels: Vec<Channel>,
    pub(crate) unread: HashMap<String, Unread>,
    pub(crate) threads: Vec<ThreadPreview>,
    pub(crate) focus_post: Option<String>,
    pub(crate) names: HashMap<String, String>,
    pub(crate) site_name: String,
    pub(crate) presence: String,
    pub(crate) peer_presence: HashMap<String, String>,
    pub(crate) members: Vec<String>,
    pub(crate) avatars: crate::avatars::Avatars,
    pub(crate) client: Option<antimatter_services::mattermost::Client>,
    pub(crate) posts: Vec<Post>,
    pub(crate) has_older: bool,
    pub(crate) ledger_offset: Arc<AtomicU32>,
    pub(crate) ledger_hand_scrolled: Arc<AtomicBool>,
    pub(crate) loading_older: bool,
    pub(crate) pending: Option<Pending>,
    pub(crate) ready: bool,
    pub(crate) busy: bool,
    pub(crate) connection: websocket::State,
    pub(crate) error: Option<&'static str>,
    pub(crate) settings: Option<rune::WindowHandle>,
    pub(crate) settings_app: Option<rune::AppHandle<crate::settings::SettingsState>>,
    pub(crate) settings_rows: Vec<crate::settings::AccountRow>,
}

impl State {
    pub(crate) fn begin_edit_account(&mut self, key: AccountKey) {
        if self.busy || self.synthetic || self.account.is_some() {
            return;
        }
        let Some(account) = self.accounts.iter().find(|account| account.key == key) else {
            return;
        };
        self.server.text = key.origin().to_owned();
        self.login.text = account.username.clone();
        self.method = match account.login_method {
            Some(LoginMethod::Password) => 1,
            Some(LoginMethod::Sso) if cfg!(target_os = "macos") => 2,
            _ => 0,
        };
        self.editing_account = Some(key);
        self.saved_account_menu = None;
        self.error = None;
    }

    pub(crate) fn cancel_edit_account(&mut self) {
        if self.busy {
            return;
        }
        self.editing_account = None;
        self.pat.clear();
        self.password.clear();
        self.error = None;
    }

    pub(crate) fn remove_account(&mut self, key: AccountKey) {
        self.saved_account_menu = None;
        self.sign_out(key);
    }

    pub(crate) fn load_custom_emoji(&mut self) {
        let (Some(client), Some(runtime), Some(handle)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let Ok(list) = client.custom_emojis().await else {
                return;
            };
            let names = list.iter().map(|e| e.name.clone()).collect();
            handle.update(move |s, _| s.custom_emoji = names);
            for emoji in list {
                let Ok(bytes) = client.custom_emoji_image(&emoji.id).await else {
                    continue;
                };
                handle.update(move |s, _| {
                    s.avatars
                        .finish(format!("emoji:{}", emoji.name), Some(bytes))
                });
            }
        });
    }

    pub(crate) fn touch_active(&mut self) {
        const EVERY: std::time::Duration = std::time::Duration::from_secs(60);
        if self.synthetic || self.intents.is_none() || self.channel.is_none() || !self.ready {
            return;
        }
        let now = std::time::Instant::now();
        if self.last_active.is_some_and(|t| now.duration_since(t) < EVERY) {
            return;
        }
        let sent = self
            .intents
            .as_ref()
            .is_some_and(|tx| tx.try_send(Intent::Active).is_ok());
        if sent {
            self.last_active = Some(now);
        }
    }

    pub(crate) fn open_new(&mut self, kind: NewKind) {
        self.new_menu = false;
        self.new_dialog = Some(kind);
        self.new_name = TextEdit::default();
        self.new_error = None;
        self.new_busy = false;
    }

    pub(crate) fn close_new(&mut self) {
        self.new_dialog = None;
        self.new_busy = false;
    }

    pub(crate) fn submit_new(&mut self) {
        let Some(kind) = self.new_dialog else {
            return;
        };
        let input = self.new_name.text.trim().trim_start_matches('@').to_owned();
        let me = self.authenticated.as_ref().map(|k| k.user_id().to_owned());
        let (Some(client), Some(runtime), Some(handle), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.handle.clone(),
            me,
        ) else {
            return;
        };
        if self.new_busy || input.is_empty() {
            return;
        }
        let team = self.team_ids.first().cloned().unwrap_or_default();
        self.new_busy = true;
        self.new_error = None;
        runtime.spawn(async move {
            let result: Result<String, &'static str> = async {
                let created = match kind {
                    NewKind::Channel => {
                        let slug: String = input
                            .to_lowercase()
                            .chars()
                            .map(|c| if c.is_alphanumeric() { c } else { '-' })
                            .collect();
                        let slug = slug.trim_matches('-').chars().take(64).collect::<String>();
                        if slug.is_empty() || team.is_empty() {
                            return Err("Enter a valid channel name.");
                        }
                        client
                            .create_channel(&serde_json::json!({
                                "team_id": team,
                                "name": slug,
                                "display_name": input,
                                "type": "O",
                            }))
                            .await
                            .map_err(|_| "Could not create the channel.")?
                    }
                    NewKind::Dm => {
                        let users = client
                            .users_by_usernames(std::slice::from_ref(&input))
                            .await
                            .map_err(|_| "Could not look up that user.")?;
                        let user = users.first().ok_or("No user with that username.")?;
                        client
                            .direct_channel(&[me, user.id.clone()])
                            .await
                            .map_err(|_| "Could not start the conversation.")?
                    }
                };
                created
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(str::to_owned)
                    .ok_or("The server returned no channel.")
            }
            .await;
            handle.update(move |s, _| {
                s.new_busy = false;
                match result {
                    Ok(id) => {
                        s.new_dialog = None;
                        s.load(id);
                    }
                    Err(message) => s.new_error = Some(message.to_owned()),
                }
            });
        });
    }

    pub(crate) fn toggle_reaction(&mut self, post_id: String, name: String) {
        self.emoji_picker = None;
        let me = self.authenticated.as_ref().map(|k| k.user_id().to_owned());
        let (Some(client), Some(runtime), Some(handle), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.handle.clone(),
            me,
        ) else {
            return;
        };
        let Some(post) = self.posts.iter().find(|p| p.id == post_id) else {
            return;
        };
        let mine = post
            .metadata
            .reactions
            .iter()
            .any(|r| r.user_id == me && r.emoji_name == name);
        runtime.spawn(async move {
            let done = if mine {
                client.remove_reaction(&me, &post_id, &name).await
            } else {
                client.add_reaction(&me, &post_id, &name).await
            };
            if done.is_err() {
                return;
            }
            handle.update(move |s, _| {
                let Some(post) = s.posts.iter_mut().find(|p| p.id == post_id) else {
                    return;
                };
                let reactions = &mut post.metadata.reactions;
                if mine {
                    reactions.retain(|r| !(r.user_id == me && r.emoji_name == name));
                } else {
                    reactions.push(antimatter_services::mattermost::Reaction {
                        user_id: me,
                        emoji_name: name,
                    });
                }
            });
        });
    }

    pub(crate) fn fetch_preview(&mut self, url: url::Url) {
        let key = url.to_string();
        if self.previews.contains_key(&key) {
            return;
        }
        let (Some(runtime), Some(handle)) = (self.runtime.clone(), self.handle.clone()) else {
            return;
        };
        self.previews.insert(key.clone(), None);
        runtime.spawn(async move {
            let preview = antimatter_services::preview::fetch(url).await;
            handle.update(move |s, _| {
                if let Some(preview) = &preview
                    && let Some(bytes) = preview.image.clone()
                {
                    s.avatars.finish(format!("preview:{key}"), Some(bytes));
                }
                s.previews.insert(key, preview);
            });
        });
    }

    pub(crate) fn run_search(&mut self) {
        let terms = self.search.text.trim().to_owned();
        let (Some(client), Some(runtime), Some(handle)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            return;
        };
        if terms.is_empty() {
            self.search_results = None;
            return;
        }
        self.search_busy = true;
        let known: std::collections::HashSet<String> = self
            .posts
            .iter()
            .map(|p| p.user_id.clone())
            .filter(|id| self.avatars.get(id).is_some())
            .collect();
        runtime.spawn(async move {
            let Ok(page) = client.search_posts(&terms, false).await else {
                handle.update(|s, _| s.search_busy = false);
                return;
            };
            let mut posts: Vec<_> = page
                .order
                .iter()
                .filter_map(|id| page.posts.get(id).cloned())
                .collect();
            posts.sort_by_key(|p| p.create_at);
            let ids: Vec<_> = posts.iter().map(|p| p.user_id.clone()).collect();
            let users = client.users_by_ids(&ids).await.unwrap_or_default();
            handle.update(move |s, _| {
                s.names
                    .extend(users.into_iter().map(|u| (u.id.clone(), u.display_name())));
                s.search_busy = false;
                s.search_results = Some(posts);
            });
            let mut missing: Vec<String> =
                ids.into_iter().filter(|id| !known.contains(id)).collect();
            missing.sort();
            missing.dedup();
            for user_id in missing {
                let bytes = client.custom_profile_image(&user_id).await.ok();
                handle.update(move |s, _| s.avatars.finish(user_id, bytes));
            }
        });
    }

    pub(crate) fn open_thread(&mut self, id: &str, tx: &mut rune::Tx) {
        let Some(thread) = self.threads.iter().find(|t| t.id == id).cloned() else {
            return;
        };
        if self.channel.as_deref() == Some(&thread.channel_id) {
            if self.posts.iter().any(|p| p.id == thread.reply_id) {
                tx.scroll_into_view(format!("post-{}", thread.reply_id));
            }
        } else {
            let locked = !self.ready
                || self.busy
                || self.submitted
                || self.pending.is_some()
                || self.recovered_pending;
            if locked {
                return;
            }
            self.focus_post = Some(thread.reply_id.clone());
            self.load(thread.channel_id.clone());
            if self.channel.as_deref() != Some(&thread.channel_id) {
                self.focus_post = None;
                return;
            }
        }
        self.threads.retain(|t| t.id != id);
        let (Some(client), Some(runtime), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.authenticated.as_ref().map(|k| k.user_id().to_owned()),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let _ = client.read_thread(&me, &thread.team_id, &thread.id).await;
        });
    }

    pub(crate) fn open_file(&mut self, file: antimatter_services::mattermost::FileInfo) {
        self.fetch_file(file, false);
    }

    pub(crate) fn download_file(&mut self, file: antimatter_services::mattermost::FileInfo) {
        self.fetch_file(file, true);
    }

    fn fetch_file(&mut self, file: antimatter_services::mattermost::FileInfo, save: bool) {
        let (Some(client), Some(runtime)) = (self.client.clone(), self.runtime.clone()) else {
            return;
        };
        runtime.spawn(async move {
            let Ok(bytes) = client.file(&file.id, false).await else {
                return;
            };
            let name = std::path::Path::new(&file.name)
                .file_name()
                .map_or_else(|| file.id.clone().into(), ToOwned::to_owned);
            let downloads =
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads"));
            let dir = match downloads {
                Some(dir) if save => dir,
                _ => std::env::temp_dir().join("antimatter-files").join(&file.id),
            };
            let path = dir.join(name);
            if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&path, bytes).is_ok() {
                let mut open = std::process::Command::new("open");
                if save {
                    open.arg("-R");
                }
                let _ = open.arg(path).status();
            }
        });
    }

    pub(crate) fn my_username(&self) -> Option<&str> {
        let key = self.authenticated.as_ref()?;
        self.accounts
            .iter()
            .find(|a| &a.key == key)
            .map(|a| a.username.as_str())
    }

    pub(crate) fn publish_settings_accounts(&mut self) {
        let Some(settings) = self.settings_app.clone() else {
            return;
        };
        let rows: Vec<crate::settings::AccountRow> = self
            .accounts
            .iter()
            .map(|account| crate::settings::AccountRow {
                key: account.key.clone(),
                origin: account.key.origin().to_owned(),
                username: account.username.clone(),
                active: self.authenticated.as_ref() == Some(&account.key),
            })
            .collect();
        if rows == self.settings_rows {
            return;
        }
        self.settings_rows = rows.clone();
        settings.update(move |s, _| {
            s.accounts = rows;
            s.profile = Default::default();
        });
    }

    pub(crate) fn switch_account(&mut self, key: AccountKey) {
        if self.blocked() {
            return;
        }
        self.authenticate(Login::Saved(key));
    }

    pub(crate) fn add_account(&mut self) {
        if self.blocked() {
            return;
        }
        self.checkpoint(AfterCheckpoint::Disconnect);
    }
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
            accent: Default::default(),
            message_font_size: 12,
            message_spacing: MessageSpacing::default(),
            show_timeline_avatars: true,
            synthetic: false,
            sidebar: PaneState::new(264.0).range(160.0, 420.0),
            channels_collapsed: false,
            favorites_collapsed: false,
            archived_collapsed: false,
            dms_collapsed: false,
            server_open: false,
            last_active: None,
            new_menu: false,
            new_dialog: None,
            new_name: TextEdit::default(),
            new_error: None,
            new_busy: false,
            team_ids: Vec::new(),
            preview: None,
            preview_at: 0,
            tab_drag: TabDragState::new(),
            tab_menu: None,
            channel_menu: None,
            image_menu: None,
            saved_account_menu: None,
            editing_account: None,
            search: TextEdit::default(),
            search_busy: false,
            attachments: Vec::new(),
            reply_to: None,
            previews: HashMap::new(),
            emoji_picker: None,
            emoji_query: TextEdit::default(),
            emoji_tab: Some(emojis::Group::SmileysAndEmotion),
            custom_emoji: Vec::new(),
            search_results: None,
            pat: TextEdit::default().secure(),
            password: TextEdit::default().secure(),
            server: TextEdit::default(),
            login: TextEdit::default(),
            draft: crate::markdown::editor(TextEdit::default().rich()),
            raw: false,
            caret_on: true,
            source: TextEdit::default(),
            handle: None,
            runtime: None,
            scope: SessionScope::default(),
            intents: None,
            account: None,
            channel: None,
            channels: vec![],
            unread: HashMap::new(),
            threads: Vec::new(),
            focus_post: None,
            names: HashMap::new(),
            site_name: String::new(),
            presence: String::new(),
            peer_presence: HashMap::new(),
            members: Vec::new(),
            avatars: crate::avatars::Avatars::default(),
            client: None,
            posts: vec![],
            has_older: false,
            ledger_offset: Arc::new(AtomicU32::new(0)),
            ledger_hand_scrolled: Arc::new(AtomicBool::new(false)),
            loading_older: false,
            pending: None,
            ready: false,
            busy: false,
            connection: websocket::State::Idle,
            error: None,
            settings: None,
            settings_app: None,
            settings_rows: Vec::new(),
        }
    }
}
