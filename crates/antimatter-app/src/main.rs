mod auth;
mod checkpoint;
mod scenes;
mod session;
mod signin;
mod state;
#[cfg(test)]
mod tests;
mod theme;
mod timeline;
mod view;
mod widgets;
mod workspace;

use crate::scenes::synthetic_workspace;
use crate::state::*;
use crate::view::view;
use antimatter_services::{
    accounts::{self, Persistence},
    conversation::Pending,
    mattermost::{self},
};
use antimatter_theme::Theme;
use rune::{AppSpec, TextEdit};
use std::sync::Arc;

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
                    },
                    failed: true,
                    retryable: false,
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
