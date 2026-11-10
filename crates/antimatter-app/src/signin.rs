use crate::state::*;
use crate::theme::workspace_theme;
use crate::widgets::*;
use crate::workspace::{TITLEBAR, workspace};
use rune::{El, col, el, text};
use rune_kit::{ButtonVariant, SegmentedControl, Switch};

#[cfg(target_os = "macos")]
const METHODS: &[&str] = &["PAT", "Password", "SSO"];
#[cfg(not(target_os = "macos"))]
const METHODS: &[&str] = &["PAT", "Password"];

pub(crate) fn application(s: &State) -> El {
    if s.account.is_some() {
        return workspace(s);
    }
    let k = workspace_theme();
    let c = &k.c;
    let primary = |key: &str, label: &str, disabled: bool, f: fn(&mut State)| {
        button_as(ButtonVariant::Contrast, key, label, disabled, f)
    };
    let mut card = col()
        .w_full()
        .max_w(420.0)
        .gap(10.0)
        .child(text("Antimatter").font(k.ty.ui_medium).color(c.text_base))
        .child(
            text("Sign in explicitly · Remember is opt-in")
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap(),
        )
        .child(field(&s.server, "server", "Server HTTPS origin", |s| {
            &mut s.server
        }))
        .child(
            SegmentedControl::new(METHODS, Some(s.method.min(METHODS.len() - 1)))
                .label("Sign-in method")
                .width(None)
                .on_pick(|s: &mut State, i, _| {
                    if !s.busy {
                        s.method = i;
                    }
                })
                .build(&k)
                .key("method"),
        );
    card = match s.method {
        0 => card
            .child(field(&s.pat, "pat", "Personal access token", |s| {
                &mut s.pat
            }))
            .child(primary("connect-pat", "Login with PAT", s.busy, |s| {
                s.connect(false)
            })),
        1 => card
            .child(field(&s.login, "login", "Username or email", |s| {
                &mut s.login
            }))
            .child(field(&s.password, "password", "Password", |s| {
                &mut s.password
            }))
            .child(primary("connect-password", "Login", s.busy, |s| {
                s.connect(true)
            })),
        _ => card,
    };
    #[cfg(target_os = "macos")]
    if s.account.is_none() && s.method >= 2 {
        card = card.child(primary(
            "connect-saml",
            "Login with SSO",
            s.busy || s.synthetic,
            |s| s.saml(),
        ));
        if s.busy && s.browser.is_some() {
            card = card.child(button_as(
                ButtonVariant::Outline,
                "cancel-login",
                "Cancel browser sign-in",
                s.auth_writing,
                |s| s.clear_session(),
            ));
        }
    }
    card = card.child(
        rune::row()
            .w_full()
            .center_y()
            .child(
                text("Remember sign-in")
                    .font(k.ty.ui)
                    .color(c.text_base)
                    .a11y_hidden(),
            )
            .child(el().grow(1.0))
            .child(
                Switch::new(s.remember)
                    .label("Remember sign-in")
                    .hide_label()
                    .disabled(s.busy)
                    .on_toggle(|s: &mut State| s.remember = !s.remember)
                    .build(&k)
                    .key("remember"),
            ),
    );
    if !s.accounts.is_empty() {
        card = card.child(section("Saved accounts · selection does not connect", &k));
        for account in &s.accounts {
            let key = account.key.clone();
            card = card.child(button_as(
                ButtonVariant::Outline,
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
            card = card
                .child(button_as(
                    ButtonVariant::Contrast,
                    "connect-saved",
                    "Connect selected saved account",
                    s.account.is_some() || s.busy || s.synthetic,
                    move |s| s.authenticate(Login::Saved(connect.clone())),
                ))
                .child(button_as(
                    ButtonVariant::Danger,
                    "sign-out",
                    "Sign out selected account (delete saved state)",
                    s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
                    move |s| s.sign_out(signout.clone()),
                ));
        }
    }
    if let Some(error) = s.error {
        card = card.child(text(error).font(k.ty.small).color(c.warning.fg).wrap());
    }
    col()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(el().w_full().h(TITLEBAR).window_drag())
        .child(
            col()
                .key("signin-scroll")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .items_center()
                .px(24.0)
                .pb(24.0)
                .child(card),
        )
}
