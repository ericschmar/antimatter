use crate::state::*;
use crate::theme::workspace_theme;
use crate::widgets::*;
use antimatter_services::conversation::Intent;
use rune::{El, col, el, text, text_input};
use rune_kit::{ButtonVariant, Sidebar, SidebarRow};

pub(crate) const TITLEBAR: f32 = 40.0;
const MAIN_MIN: f32 = 248.0;

pub(crate) fn workspace(s: &State) -> El {
    let k = workspace_theme();
    let c = &k.c;
    let locked = !s.ready || s.busy || s.submitted || s.recovered_pending || s.pending.is_some();
    let mut sidebar = Sidebar::new()
        .label("Channels")
        .header(text("CHANNELS").font(k.ty.small_medium).color(c.text_muted));
    for channel in &s.channels {
        let id = channel.id.clone();
        let disabled = locked || (s.durable.is_none() && !s.draft.text.is_empty());
        let unread = s.unread.get(&channel.id).copied().unwrap_or_default();
        let mut row = SidebarRow::new(&channel.display_name).height(32.0);
        if unread.mentions > 0 {
            row = row.badge(format!("@{}", unread.mentions));
        } else if unread.messages > 0 {
            row = row.status(rune_kit::shell::RowStatus::Unread);
        }
        let row = row
            .selected(s.channel.as_deref() == Some(&channel.id))
            .on_select(move |s: &mut State, _| {
                if !disabled {
                    s.load(id.clone());
                }
            })
            .build(&k)
            .key(format!("channel-{}", channel.id));
        sidebar = sidebar.child(if disabled {
            row.disabled(true).inert()
        } else {
            row
        });
    }
    let sidebar = col()
        .w(s.sidebar.width())
        .shrink()
        .min_w(96.0)
        .h_full()
        .fill(c.layer_01)
        .child(el().w_full().h(TITLEBAR).window_drag())
        .child(
            rune::row().h(24.0).w_full().px(12.0).center_y().child(
                text(s.account.as_deref().unwrap_or_default())
                    .font(k.ty.small)
                    .color(c.text_muted)
                    .truncate(),
            ),
        )
        .child(sidebar.build(&k));
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
        .w(5.0)
        .h_full()
        .cursor(rune::Cursor::ResizeColumn)
        .fill(c.border_base)
        .on_drag(move |s: &mut State, d: &mut rune::Drag, _| {
            if d.phase == rune::Phase::Move {
                s.sidebar.drag_to(width + d.dx);
            }
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
                    text(&post.user_id)
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
    let editor = text_input(&s.draft, k.ty.ui)
        .key("draft")
        .label("Message")
        .placeholder("Write a message…", c.text_faint)
        .w_full()
        .h(72.0)
        .padding(10.0)
        .radius(7.0)
        .border(1.0, c.border_strong)
        .fill(c.layer_02)
        .color(c.text_base);
    let composer = if locked {
        editor.disabled(true).read_only(true).inert()
    } else {
        editor.on_edit(|s: &mut State| &mut s.draft)
    };
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
                .child(
                    text(
                        s.channels
                            .iter()
                            .find(|c| Some(c.id.as_str()) == s.channel.as_deref())
                            .map_or("Conversation", |c| c.display_name.as_str()),
                    )
                    .font(k.ty.ui_medium)
                    .color(c.text_base)
                    .truncate(),
                )
                .child(el().grow(1.0))
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
        "Session-only: closing/disconnecting discards drafts. Use Remember for durable autosave."
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
            .child(rune::row().w_full().child(el().grow(1.0)).child(button_as(
                ButtonVariant::Contrast,
                "send",
                "Send",
                locked || s.channel.is_none() || s.draft.text.trim().is_empty(),
                |s| s.send(),
            ))),
    );
    rune::row()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(sidebar)
        .child(grip)
        .child(main)
}
