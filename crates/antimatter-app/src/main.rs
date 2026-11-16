mod auth;
mod avatars;
mod checkpoint;
mod composer;
#[cfg(debug_assertions)]
mod dev_login;
mod markdown;
mod notifications;
mod profile;
mod scenes;
mod session;
mod settings;
mod signin;
mod state;
mod tabs;
#[cfg(test)]
mod tests;
mod theme;
mod timeline;
mod view;
mod widgets;
mod workspace;

use crate::scenes::{synthetic_history, synthetic_workspace};
use crate::state::*;
use crate::view::view;
use antimatter_services::{
    accounts::{self, Persistence},
    conversation::Pending,
    mattermost::{self},
    settings as settings_store,
};
use antimatter_theme::Theme;
use rune::{AppSpec, TextEdit};
use std::sync::Arc;

fn settings_path() -> Option<std::path::PathBuf> {
    accounts::AccountStore::<accounts::KeychainCredentials>::default_root()
        .ok()
        .map(|root| root.join(settings_store::FILE_NAME))
}

fn settings_prefs() -> (settings_store::Settings, Option<String>) {
    let Some(path) = settings_path() else {
        return (settings_store::Settings::default(), None);
    };
    match settings_store::load(&path) {
        Ok(prefs) => (prefs, None),
        Err(error) => (
            settings_store::Settings::default(),
            Some(format!(
                "Settings could not be read ({error}). Defaults are shown and the file is kept."
            )),
        ),
    }
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
    let mut app = rune::App::new(AppSpec::<State> {
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
            ("signin-proof", |s| s.application = true),
            ("signin-light-proof", |s| {
                s.application = true;
                s.theme = Theme::Light;
            }),
            ("signin-contrast-proof", |s| {
                s.application = true;
                s.theme = Theme::HighContrast;
            }),
            ("signin-warm-proof", |s| {
                s.application = true;
                s.theme = Theme::Warm;
            }),
            ("workspace-light-proof", |s| {
                synthetic_workspace(s);
                s.theme = Theme::Light;
            }),
            ("workspace-contrast-proof", |s| {
                synthetic_workspace(s);
                s.theme = Theme::HighContrast;
            }),
            ("workspace-warm-proof", |s| {
                synthetic_workspace(s);
                s.theme = Theme::Warm;
            }),
            ("signin-password-proof", |s| {
                s.application = true;
                s.method = 1;
            }),
            ("signin-sso-proof", |s| {
                s.application = true;
                s.method = 2;
            }),
            ("conversation-proof", synthetic_workspace),
            ("workspace-proof", synthetic_workspace),
            ("workspace-emoji-proof", |s| {
                synthetic_workspace(s);
                s.emoji_picker = Some("synthetic-post".into());
            }),
            ("workspace-preview-proof", |s| {
                synthetic_workspace(s);
                s.posts[0].message = "Look at https://example.com/hooli".into();
                s.previews.insert(
                    "https://example.com/hooli".into(),
                    Some(antimatter_services::preview::Preview {
                        url: "https://example.com/hooli".into(),
                        site: "Hooli Newsroom".into(),
                        title: "Introducing Hooli Nucleus".into(),
                        description: "Making the world a better place, through minimal message-oriented transport layers.".into(),
                        image: None,
                    }),
                );
            }),
            ("workspace-threads-proof", |s| {
                synthetic_workspace(s);
                s.names.insert("synthetic-peer".into(), "Marley".into());
                s.threads = vec![
                    antimatter_services::conversation::ThreadPreview {
                        id: "thread-1".into(),
                        team_id: "synthetic-team".into(),
                        channel_id: "synthetic-other".into(),
                        root_message: "Church, 2 PM\nChoir practice. Mostly empty pews.".into(),
                        unread_replies: 6,
                        unread_mentions: 0,
                        reply_id: "reply-1".into(),
                        reply_user_id: "synthetic-peer".into(),
                        reply_message: "Merry Christmas, Kevin.".into(),
                    },
                    antimatter_services::conversation::ThreadPreview {
                        id: "thread-2".into(),
                        team_id: "synthetic-team".into(),
                        channel_id: "synthetic-other".into(),
                        root_message: "Old Man Marley\nBuzz says. Nobody can prove it.".into(),
                        unread_replies: 1,
                        unread_mentions: 0,
                        reply_id: "reply-2".into(),
                        reply_user_id: "synthetic-peer".into(),
                        reply_message: "Merry Christmas.".into(),
                    },
                ];
            }),
            ("workspace-search-proof", |s| {
                synthetic_workspace(s);
                s.search = rune::TextEdit::new("synthetic".to_owned());
                s.search_results = Some(s.posts.clone());
            }),
            ("workspace-tabs-proof", |s| {
                synthetic_workspace(s);
                s.navigation.tabs.push("synthetic-other".into());
                s.preview = Some("synthetic-third".into());
                s.channels.push(mattermost::Channel {
                    id: "synthetic-third".into(),
                    team_id: "synthetic-team".into(),
                    name: "synthetic-third".into(),
                    display_name: "synthetic-third".into(),
                    kind: "O".into(),
                    members: Vec::new(),
                });
            }),
            ("workspace-history-proof", |s| {
                synthetic_workspace(s);
                s.has_older = true;
            }),
            ("workspace-spacing-large-proof", |s| {
                synthetic_workspace(s);
                s.message_spacing = antimatter_services::settings::MessageSpacing::Large;
            }),
            ("workspace-avatars-off-proof", |s| {
                synthetic_workspace(s);
                s.show_timeline_avatars = false;
            }),
            ("workspace-scroll-history-proof", synthetic_history),
            ("workspace-loading-older-proof", |s| {
                synthetic_workspace(s);
                s.has_older = true;
                s.loading_older = true;
            }),
            ("empty-channel-proof", |s| {
                synthetic_workspace(s);
                s.channel = None;
                s.posts.clear();
                s.navigation.tabs.clear();
            }),
            ("workspace-locked-proof", |s| {
                synthetic_workspace(s);
                s.submitted = true;
            }),
            ("workspace-retry-proof", |s| {
                synthetic_workspace(s);
                s.draft = TextEdit::new("synthetic draft");
                s.pending = Some(Pending {
                    post: mattermost::CreatePost {
                        channel_id: "synthetic-channel".into(),
                        message: "synthetic draft".into(),
                        pending_post_id: "synthetic-pending".into(),
                        file_ids: vec![],
                        root_id: String::new(),
                    },
                    failed: true,
                    retryable: false,
                });
            }),
        ],
        poll: Some(|s, clock, tx| {
            const HALF: f64 = 0.53;
            tx.wake_after(std::time::Duration::from_secs_f64(HALF - clock % HALF));
            let on = ((clock / HALF) as u64).is_multiple_of(2);
            std::mem::replace(&mut s.caret_on, on) != on
        }),
        on_key: Some(crate::tabs::window_key),
        setup: Some(|s, waker| s.avatars = crate::avatars::Avatars::new(waker)),
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
    let (prefs, load_error) = settings_prefs();
    let prefs_font_size = prefs.message_font_size;
    let prefs_spacing = prefs.timeline_message_spacing;
    let prefs_avatars = prefs.show_timeline_avatars;
    let prefs_avatar_size = prefs.timeline_avatar_size;
    let prefs_notify = (
        prefs.notifications_enabled,
        prefs.notification_sounds_enabled,
    );
    let prefs_accent = prefs.accent_color;
    let prefs_theme = crate::settings::theme_for(prefs.theme);
    let handle = app.handle();
    let (settings, settings_app) =
        crate::settings::window(&mut app, prefs, settings_path(), load_error, handle.clone());
    let app = app.menu_item(
        rune::MenuItem::new("Settings…", |s: &mut State, _: &mut rune::Tx| {
            if let Some(settings) = &s.settings {
                settings.open();
            }
        })
        .after("About Antimatter")
        .key_equivalent(",".parse().expect("valid Settings shortcut")),
    );
    app.init(move || {
        let mut state = State {
            settings: Some(settings),
            settings_app: Some(settings_app),
            message_font_size: prefs_font_size,
            message_spacing: prefs_spacing,
            show_timeline_avatars: prefs_avatars,
            avatar_size: prefs_avatar_size,
            accent: prefs_accent,
            notifications_enabled: prefs_notify.0,
            notification_sounds_enabled: prefs_notify.1,
            ..State::default()
        };
        if !rune::is_headless() {
            state.application = true;
            #[cfg(debug_assertions)]
            dev_login::prefill(&mut state);
            state.runtime = Some(Arc::new(
                tokio::runtime::Runtime::new().expect("background runtime"),
            ));
            state.theme = prefs_theme;
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
    .titlebar(rune::Titlebar::new(crate::workspace::TITLEBAR))
    .turn_scope(|_| {}, State::autosave)
    .on_close(|s, _| s.close())
    .run();
}
