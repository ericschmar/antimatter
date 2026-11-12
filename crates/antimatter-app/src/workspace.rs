use crate::state::*;
use crate::tabs::tab_strip;
use crate::theme::workspace_theme;
use crate::widgets::*;
use antimatter_services::accounts::Account;
use antimatter_services::conversation::Intent;
use antimatter_services::mattermost::Channel;
use antimatter_theme::icons;
use rune::{El, Icon, col, el, icon, row as hbox, text};
use rune_kit::{ButtonVariant, MenuItem, Select, SidebarRow};

pub(crate) const TITLEBAR: f32 = 40.0;
const TRAFFIC_LIGHTS: f32 = 84.0;
const MAIN_MIN: f32 = 248.0;
const SECTION_HEADER_HEIGHT: f32 = 24.0;

static DISCLOSURE_OPEN: Icon = Icon {
    name: "antimatter-disclosure-open",
    view: 16.0,
    body: r#"<path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
static DISCLOSURE_CLOSED: Icon = Icon {
    name: "antimatter-disclosure-closed",
    view: 16.0,
    body: r#"<path d="M6 4L10 8L6 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

fn server_labels(s: &State) -> Vec<String> {
    let label = |account: &Account| {
        if s.authenticated.as_ref() == Some(&account.key) && !s.site_name.is_empty() {
            s.site_name.clone()
        } else {
            account.key.origin().to_owned()
        }
    };
    s.accounts
        .iter()
        .map(|account| {
            let base = label(account);
            let shared = s
                .accounts
                .iter()
                .filter(|other| label(other) == base)
                .count()
                > 1;
            if shared {
                format!("{base} ({})", account.username)
            } else {
                base
            }
        })
        .collect()
}

fn server_menu(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit, width: f32) -> El {
    let names = server_labels(s);
    let current = s
        .accounts
        .iter()
        .position(|account| s.authenticated.as_ref() == Some(&account.key))
        .map(|i| names[i].clone())
        .or_else(|| s.account.clone())
        .unwrap_or_default();
    let trigger = Select::new("server", &names)
        .current(Some(&current))
        .open(s.server_open)
        .on_toggle(|s: &mut State| s.server_open = !s.server_open)
        .trigger(k)
        .w(width);
    let mut menu = rune_kit::Menu::new("server-menu")
        .trigger(trigger)
        .open(s.server_open)
        .on_close(|s: &mut State| s.server_open = false);
    for (i, name) in names.iter().enumerate() {
        menu = menu.item(MenuItem::new(name.clone()).on_select(move |s: &mut State| {
            s.server_open = false;
            if let Some(account) = s.accounts.get(i) {
                let key = account.key.clone();
                s.switch_account(key);
            }
        }));
    }
    menu.build(k, layer)
}

fn section(
    key: &str,
    title: &str,
    count: usize,
    collapsed: bool,
    toggle: fn(&mut State, &mut rune::Tx),
    rows: Vec<El>,
    k: &rune_kit::Kit,
) -> El {
    let c = &k.c;
    let disclosure = if collapsed {
        &DISCLOSURE_CLOSED
    } else {
        &DISCLOSURE_OPEN
    };
    let header = hbox()
        .key(format!("{key}-header"))
        .role("button")
        .label(title)
        .expanded(!collapsed)
        .w_full()
        .h(SECTION_HEADER_HEIGHT)
        .px(8.0)
        .gap(4.0)
        .center_y()
        .child(icon(disclosure, 12.0).color(c.icon_faint).a11y_hidden())
        .child(
            text(title.to_uppercase())
                .font(k.ty.text_xsmall)
                .color(c.text_muted)
                .truncate()
                .shrink(),
        )
        .child(el().grow(1.0).a11y_hidden())
        .child(
            text(count.to_string())
                .font(k.ty.text_xsmall)
                .color(c.text_faint)
                .a11y_hidden(),
        );
    let header = k.interactive(header).on_press_tx(toggle).focusable(false);
    let mut group = col()
        .key(key)
        .role("group")
        .label(title)
        .w_full()
        .gap(2.0)
        .child(header);
    if !collapsed {
        group = group.children(rows);
    }
    group
}

fn channel_row(s: &State, channel: &Channel, locked: bool, k: &rune_kit::Kit) -> El {
    let id = channel.id.clone();
    let unread = s.unread.get(&channel.id).copied().unwrap_or_default();
    let mut row = SidebarRow::new(&channel.display_name)
        .height(28.0)
        .depth(1)
        .title_style(k.ty.small);
    if !matches!(channel.kind.as_str(), "D" | "G") {
        row = row.icon(&icons::HASH);
    }
    if unread.mentions > 0 {
        row = row.badge(format!("@{}", unread.mentions));
    } else if unread.messages > 0 {
        row = row.status(rune_kit::shell::RowStatus::Unread);
    }
    let open = channel.id.clone();
    let row = row
        .selected(s.channel.as_deref() == Some(&channel.id))
        .on_select(move |s: &mut State, _| {
            if !locked {
                s.load(id.clone());
            }
        })
        .on_double_click(move |s: &mut State, _| {
            if !locked {
                s.open_durable(open.clone());
            }
        })
        .build(k)
        .key(format!("channel-{}", channel.id));
    if locked {
        row.disabled(true).inert()
    } else {
        row
    }
}

pub(crate) fn workspace(s: &State) -> El {
    let mut layer = Vec::new();
    let k = workspace_theme();
    let c = &k.c;
    let locked = !s.ready || s.busy || s.submitted || s.recovered_pending || s.pending.is_some();
    let (direct, regular): (Vec<_>, Vec<_>) = s
        .channels
        .iter()
        .partition(|channel| matches!(channel.kind.as_str(), "D" | "G"));
    let mut sidebar = col().w_full().gap(8.0).child(section(
        "channels",
        "Channels",
        regular.len(),
        s.channels_collapsed,
        |s: &mut State, _| s.channels_collapsed = !s.channels_collapsed,
        regular
            .into_iter()
            .map(|channel| channel_row(s, channel, locked, &k))
            .collect(),
        &k,
    ));
    sidebar = sidebar.child(section(
        "direct-messages",
        "Direct messages",
        direct.len(),
        s.dms_collapsed,
        |s: &mut State, _| s.dms_collapsed = !s.dms_collapsed,
        direct
            .into_iter()
            .map(|channel| channel_row(s, channel, locked, &k))
            .collect(),
        &k,
    ));
    let sidebar = col()
        .w(s.sidebar.width())
        .shrink()
        .min_w(96.0)
        .h_full()
        .fill(c.layer_01)
        .child(
            rune::row()
                .w_full()
                .h(TITLEBAR)
                .pr(12.0)
                .center_y()
                .window_drag()
                .child(el().w(TRAFFIC_LIGHTS).h_full().window_drag())
                .child(
                    rune::row()
                        .w(s.sidebar.width() - TRAFFIC_LIGHTS - 12.0)
                        .shrink()
                        .window_drag()
                        .child(server_menu(
                            s,
                            &mut layer,
                            &k,
                            s.sidebar.width() - TRAFFIC_LIGHTS - 12.0,
                        )),
                ),
        )
        .child(sidebar);
    let width = s.sidebar.width();
    let grip = el()
        .key("sidebar-grip")
        .role("separator")
        .label("Resize sidebar")
        .range_value(
            f64::from(width),
            f64::from(s.sidebar.min_width()),
            f64::from(s.sidebar.max_width()),
        )
        .range_step(8.0)
        .w(2.0)
        .h_full()
        .cursor(rune::Cursor::ResizeColumn)
        .fill(c.border_base)
        .on_drag(|s: &mut State, d: &mut rune::Drag, _| match d.phase {
            rune::Phase::Down => d.data = s.sidebar.width(),
            rune::Phase::Move => s.sidebar.drag_to(d.data + d.dx),
            rune::Phase::Up => {}
        });
    let mut ledger = col()
        .key("timeline")
        .grow(1.0)
        .min_h(0.0)
        .scroll(rune::ScrollSpec { stick_bottom: true });
    for post in &s.posts {
        ledger = ledger.child(
            rune::row()
                .key(format!("post-{}", post.id))
                .w_full()
                .gap(8.0)
                .px(16.0)
                .py(8.0)
                .child(
                    text(s.names.get(&post.user_id).unwrap_or(&post.user_id))
                        .w(96.0)
                        .shrink()
                        .font(k.ty.small)
                        .color(c.text_muted)
                        .truncate(),
                )
                .child(
                    text(&post.message)
                        .grow(1.0)
                        .shrink()
                        .min_w(0.0)
                        .font(k.ty.ui)
                        .color(c.text_base)
                        .wrap(),
                ),
        );
    }
    let (composer, toolbar) = crate::composer::composer(s, locked);
    let mut main = col()
        .grow(1.0)
        .min_w(MAIN_MIN)
        .h_full()
        .fill(c.bg_base)
        .child(
            rune::row()
                .w_full()
                .h(TITLEBAR)
                .px(16.0)
                .center_y()
                .gap(12.0)
                .window_drag()
                .child(tab_strip(s, &mut layer))
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
                )),
        );
    let notice = if s.durable.is_some() {
        if s.checkpoint_retry.is_some() {
            "UNSAVED: retry durable update before closing. Closing cannot be blocked; failed writes lose the latest edits."
        } else if s.busy {
            "Saving durable state… wait before closing. Accepted writes cannot be cancelled or rolled back."
        } else {
            "Drafts autosave after edits. A crash or failed write can lose the latest edit. Pending delivery blocks switching/sign-out."
        }
    } else {
        "Session-only: per-tab drafts are kept in memory; closing/disconnecting discards them. Use Remember for durable autosave."
    };
    let mut actions = rune::row().w_full().gap(8.0).flex_wrap().child(button(
        "disconnect",
        "Disconnect session",
        s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
        |s| s.checkpoint(AfterCheckpoint::Disconnect),
    ));
    if s.durable.is_some() {
        actions = actions.child(button(
            "save-draft",
            "Save draft",
            s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
            |s| s.checkpoint(AfterCheckpoint::Save),
        ));
    }
    main = main.child(
        col()
            .w_full()
            .px(16.0)
            .pb(8.0)
            .gap(4.0)
            .child(
                text(format!(
                    "Connection: {:?}{}",
                    s.connection,
                    if s.ready { "" } else { " · refreshing" }
                ))
                .font(k.ty.small)
                .color(c.text_muted),
            )
            .child(text(notice).font(k.ty.small).color(c.text_muted).wrap())
            .child(actions),
    );
    let mut status = col().w_full().px(16.0).pb(8.0).gap(8.0);
    if s.recovered_pending {
        status = status.child(text("Unresolved durable submission. Text is retained below and cannot be resent, switched or signed out; delivery recovery requires manual verification.").color(c.warning.fg).wrap());
        for draft in s.drafts.iter().filter(|d| d.pane_id == SUBMITTED) {
            status = status.child(
                text(format!("{}: {}", draft.channel_id, draft.text))
                    .color(c.warning.fg)
                    .wrap(),
            );
        }
    }
    if s.checkpoint_retry.is_some() {
        status = status.child(
            button(
                "retry-save",
                "Retry durable update (does not resend)",
                s.busy,
                |s| {
                    if let Some(action) = s.checkpoint_retry.take() {
                        s.checkpoint(action);
                    }
                },
            )
            .self_start(),
        );
    }
    if let Some(pending) = &s.pending {
        status = status
            .child(
                text(if pending.failed {
                    "Pending delivery · draft retained"
                } else {
                    "Sending…"
                })
                .color(c.warning.fg)
                .wrap(),
            )
            .child(
                button(
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
                )
                .self_start(),
            );
    }
    if let Some(error) = s.error {
        status = status.child(text(error).color(c.warning.fg).wrap());
    }
    if s.recovered_pending
        || s.checkpoint_retry.is_some()
        || s.pending.is_some()
        || s.error.is_some()
    {
        main = main.child(status);
    }
    main = main.child(ledger).child(
        col()
            .w_full()
            .px(16.0)
            .py(8.0)
            .gap(8.0)
            .fill(c.layer_01)
            .child(composer)
            .child(
                rune::row()
                    .w_full()
                    .gap(8.0)
                    .center_y()
                    .child(toolbar)
                    .child(button_as(
                        ButtonVariant::Contrast,
                        "send",
                        "Send",
                        locked || s.channel.is_none() || s.markdown().trim().is_empty(),
                        |s| s.send(),
                    )),
            ),
    );
    let body = rune::row()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(sidebar)
        .child(grip)
        .child(main);
    rune_kit::root(body, layer)
}
