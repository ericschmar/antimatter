use crate::state::*;
use crate::theme::workspace_theme;
use crate::widgets::*;
use crate::workspace::{TITLEBAR, workspace};
use antimatter_services::accounts::LoginMethod;
use rune::{El, col, el, text};
use rune_kit::{ButtonVariant, MenuItem, SegmentedControl, Switch, context_menu};

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
            text(if s.editing_account.is_some() {
                "Update saved sign-in · existing credentials stay active until verified"
            } else {
                "Sign in explicitly · Remember is opt-in"
            })
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
            .child(primary(
                "connect-pat",
                if s.editing_account.is_some() {
                    "Verify & update saved sign-in"
                } else {
                    "Login with PAT"
                },
                s.busy,
                |s| s.connect(false),
            )),
        1 => card
            .child(field(&s.login, "login", "Username or email", |s| {
                &mut s.login
            }))
            .child(field(&s.password, "password", "Password", |s| {
                &mut s.password
            }))
            .child(primary(
                "connect-password",
                if s.editing_account.is_some() {
                    "Verify & update saved sign-in"
                } else {
                    "Login"
                },
                s.busy,
                |s| s.connect(true),
            )),
        _ => card,
    };
    #[cfg(target_os = "macos")]
    if s.account.is_none() && s.method >= 2 {
        card = card.child(primary(
            "connect-saml",
            if s.editing_account.is_some() {
                "Verify & update saved sign-in"
            } else {
                "Login with SSO"
            },
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
    if s.editing_account.is_some() {
        card = card.child(button_as(
            ButtonVariant::Outline,
            "cancel-edit-account",
            "Cancel update",
            s.busy,
            |s| s.cancel_edit_account(),
        ));
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
    let mut layer = Vec::new();
    if !s.accounts.is_empty() {
        card = card.child(section("Saved accounts", &k));
        for account in &s.accounts {
            let key = account.key.clone();
            let method = account
                .login_method
                .map_or("Method not recorded", LoginMethod::label);
            let open_menu = s
                .saved_account_menu
                .as_ref()
                .is_some_and(|(menu_key, _)| menu_key == &account.key)
                .then(|| s.saved_account_menu.as_ref().unwrap().1);
            let trigger_key = key.clone();
            let row = rune::col()
                .key(format!("account-{}", account.local_id))
                .w_full()
                .gap(7.0)
                .px(12.0)
                .py(10.0)
                .radius(k.radius.md)
                .fill(c.layer_01)
                .border(1.0, c.border_base)
                .hover(c.hover)
                .cursor(rune::Cursor::Pointer)
                .role("button")
                .label(format!(
                    "{}, {}, {}",
                    account.username,
                    account.key.origin(),
                    method
                ))
                .focusable(true)
                .on_press(move |s: &mut State| {
                    s.authenticate(Login::Saved(key.clone()));
                })
                .on_secondary_press(move |s: &mut State, point, _| {
                    s.saved_account_menu = Some((trigger_key.clone(), point));
                })
                .child(
                    text(&account.username)
                        .font(k.ty.text_small_medium)
                        .color(c.text_base)
                        .truncate(),
                )
                .child(
                    rune::row()
                        .w_full()
                        .center_y()
                        .gap(8.0)
                        .child(
                            text(account.key.origin())
                                .font(k.ty.mono)
                                .color(c.text_muted)
                                .grow(1.0)
                                .truncate(),
                        )
                        .child(
                            text(method)
                                .font(k.ty.small_medium)
                                .color(c.text_muted)
                                .px(7.0)
                                .py(3.0)
                                .radius(4.0)
                                .fill(c.layer_02),
                        ),
                );
            let menu = context_menu(format!("account-menu-{}", account.local_id), row, open_menu)
                .item({
                    let key = account.key.clone();
                    MenuItem::new("Edit").on_select(move |s: &mut State| {
                        s.begin_edit_account(key.clone());
                    })
                })
                .item({
                    let key = account.key.clone();
                    MenuItem::new("Delete")
                        .danger(true)
                        .disabled(
                            s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
                        )
                        .on_select(move |s: &mut State| s.remove_account(key.clone()))
                })
                .on_close(|s: &mut State| s.saved_account_menu = None)
                .build(&k, &mut layer);
            card = card.child(menu);
        }
    }
    if let Some(error) = s.error {
        card = card.child(text(error).font(k.ty.small).color(c.warning.fg).wrap());
    }
    rune_kit::root(
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
            ),
        layer,
    )
}
