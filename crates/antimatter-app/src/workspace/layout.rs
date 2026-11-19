use super::*;
use super::sidebar::section;

pub(crate) fn workspace(s: &State) -> El {
    let mut layer = Vec::new();
    let k = workspace_theme();
    let c = &k.c;
    let locked = !s.ready || s.busy || s.submitted || s.recovered_pending || s.pending.is_some();
    let composer_locked = s.busy || s.submitted || s.recovered_pending || s.pending.is_some();
    let current_team = s.current_team_id();
    let (archived, rest): (Vec<_>, Vec<_>) = s
        .channels
        .iter()
        .filter(|channel| {
            matches!(channel.kind.as_str(), "D" | "G")
                || current_team
                    .as_deref()
                    .is_none_or(|team| channel.team_id == team)
        })
        .partition(|channel| s.navigation.archived.contains(&channel.id));
    let (favorites, rest): (Vec<_>, Vec<_>) = rest
        .into_iter()
        .partition(|channel| s.navigation.favorites.contains(&channel.id));
    let (mut direct, regular): (Vec<_>, Vec<_>) = rest
        .into_iter()
        .partition(|channel| matches!(channel.kind.as_str(), "D" | "G"));
    direct.sort_by_key(|channel| std::cmp::Reverse(channel.last_post_at));
    let point = s.channel_menu.clone();
    let channel = point.as_ref().map(|(id, _)| id.clone()).unwrap_or_default();
    let favorite = s.navigation.favorites.contains(&channel);
    let archive = s.navigation.archived.contains(&channel);
    let muted = s.channels.iter().any(|c| c.id == channel && c.muted);
    let channel_menu =
        rune_kit::context_menu("channel-menu", el().w(0.0).h(0.0), point.map(|(_, p)| p))
            .on_close(|s: &mut State| s.channel_menu = None)
            .item({
                let channel = channel.clone();
                MenuItem::new(if favorite { "Unfavorite" } else { "Favorite" })
                    .icon(&icons::STAR)
                    .on_select(move |s: &mut State| {
                        s.channel_menu = None;
                        s.toggle_favorite(&channel);
                    })
            })
            .item({
                let channel = channel.clone();
                MenuItem::new(if archive { "Unarchive" } else { "Archive" })
                    .icon(if archive {
                        &icons::TRAY_ARROW_UP
                    } else {
                        &icons::ARCHIVE
                    })
                    .on_select(move |s: &mut State| {
                        s.channel_menu = None;
                        s.toggle_archived(&channel);
                    })
            })
            .item({
                let channel = channel.clone();
                MenuItem::new(if muted { "Unmute" } else { "Mute" })
                    .icon(if muted {
                        &icons::BELL
                    } else {
                        &icons::BELL_SLASH
                    })
                    .on_select(move |s: &mut State| {
                        s.channel_menu = None;
                        s.set_channel_mute(channel.clone(), !muted);
                    })
            })
            .build(&crate::theme::menu_theme(&k), &mut layer);
    let mut sidebar = col().w_full().gap(8.0).children(threads_section(s, &k));
    if !favorites.is_empty() {
        sidebar = sidebar.child(section(
            "favorites",
            "Favorites",
            favorites.len(),
            s.favorites_collapsed,
            |s: &mut State, _| s.favorites_collapsed = !s.favorites_collapsed,
            favorites
                .into_iter()
                .map(|channel| channel_row(s, channel, locked, &k))
                .collect(),
            &k,
        ));
    }
    new_dialog(s, &mut layer, &k);
    create_poll_dialog(s, &mut layer, &k);
    end_poll_dialog(s, &mut layer, &k);
    gif_picker(s, &mut layer, &k);
    sidebar = sidebar.child(section(
        "channels",
        "Channels",
        regular.len(),
        s.channels_collapsed,
        |s: &mut State, _| s.channels_collapsed = !s.channels_collapsed,
        std::iter::once(new_row(
            "create-channel",
            "Create channel…",
            NewKind::Channel,
            &k,
        ))
        .chain(
            regular
                .into_iter()
                .map(|channel| channel_row(s, channel, locked, &k)),
        )
        .collect(),
        &k,
    ));
    sidebar = sidebar.child(section(
        "direct-messages",
        "Direct messages",
        direct.len(),
        s.dms_collapsed,
        |s: &mut State, _| s.dms_collapsed = !s.dms_collapsed,
        std::iter::once(new_row(
            "start-dm",
            "Start direct message…",
            NewKind::Dm,
            &k,
        ))
        .chain(
            direct
                .into_iter()
                .map(|channel| channel_row(s, channel, locked, &k)),
        )
        .collect(),
        &k,
    ));
    if !archived.is_empty() {
        sidebar = sidebar.child(section(
            "archived",
            "Archived",
            archived.len(),
            s.archived_collapsed,
            |s: &mut State, _| s.archived_collapsed = !s.archived_collapsed,
            archived
                .into_iter()
                .map(|channel| channel_row(s, channel, locked, &k))
                .collect(),
            &k,
        ));
    }
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
                        .shrink()
                        .window_drag()
                        .child(server_menu(s, &mut layer, &k)),
                )
                .child(el().grow(1.0).window_drag())
                .child(user_avatar(s, &k)),
        )
        .child(
            rune::row()
                .key("sidebar-search")
                .role("search")
                .label("Search")
                .h(28.0)
                .mx(8.0)
                .my(4.0)
                .px(8.0)
                .gap(6.0)
                .radius(6.0)
                .fill(c.layer_02)
                .center_y()
                .child(
                    icon(&icons::MAGNIFYING_GLASS, 14.0)
                        .color(c.icon_muted)
                        .a11y_hidden(),
                )
                .child(
                    rune::text_input(&s.search, k.ty.small)
                        .key("search")
                        .label("Search")
                        .single_line()
                        .grow(1.0)
                        .min_w(0.0)
                        .color(c.text_base)
                        .placeholder("Search", c.text_muted)
                        .caret(s.caret(c.text_base), k.selection())
                        .on_edit(|s: &mut State| &mut s.search)
                        .on_submit(|s: &mut State, _| s.run_search()),
                )
                .children(s.search_busy.then(|| {
                    rune::icon(&antimatter_theme::loader::SPINNER, 14.0)
                        .color(c.icon_muted)
                        .looping(rune::LoopSpec::rotation(0.9))
                        .label("Searching")
                        .role("progressbar")
                }))
                .child(
                    IconButton::new(&icons::FUNNEL)
                        .label("Search filters")
                        .help("Search filters")
                        .control_size(ControlSize::Small)
                        .variant(if s.search_filters_open {
                            IconButtonVariant::Contrast
                        } else {
                            IconButtonVariant::Ghost
                        })
                        .on_press(|s: &mut State| s.search_filters_open = !s.search_filters_open)
                        .build(&k)
                        .key("search-filters-toggle"),
                )
                .children(s.search.text.is_empty().then(|| {
                    hbox()
                        .key("search-hint")
                        .h(18.0)
                        .px(5.0)
                        .center()
                        .radius(4.0)
                        .border(1.0, c.border_base)
                        .a11y_hidden()
                        .child(text("⌘K").font(k.ty.small).color(c.text_muted))
                })),
        )
        .children(s.search_filters_open.then(|| search_filters(s, &k)))
        .child(
            sidebar
                .key("sidebar-channels")
                .grow(1.0)
                .min_h(0.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .scroll_bar_styled(ScrollBarStyle::scroll_view(&k)),
        )
        .child(channel_menu);
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
        .w(1.0)
        .h_full()
        .cursor(rune::Cursor::ResizeColumn)
        .fill(c.border_base)
        .on_drag(|s: &mut State, d: &mut rune::Drag, _| match d.phase {
            rune::Phase::Down => d.data = s.sidebar.width(),
            rune::Phase::Move => s.sidebar.drag_to(d.data + d.dx),
            rune::Phase::Up => {}
        });
    let offset = s.ledger_offset.clone();
    let hand_scrolled = s.ledger_hand_scrolled.clone();
    let searching = s.search_results.is_some();
    let mut ledger = col()
        .key(if searching {
            "search-results"
        } else {
            "timeline"
        })
        .grow(1.0)
        .min_h(0.0)
        .scroll(rune::ScrollSpec {
            stick_bottom: !searching,
        })
        .scroll_anchor()
        .on_layout_tx(|s: &mut State, _, tx| s.reveal_focus_post(tx))
        .on_scroll_offset(move |at| {
            offset.store(at.offset[1].to_bits(), std::sync::atomic::Ordering::Relaxed);
            if rune::scroll_watch_state().0 {
                hand_scrolled.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        });
    if s.has_older && s.search_results.is_none() {
        ledger = ledger.child(
            rune::row()
                .key("older-sentinel")
                .w_full()
                .px(16.0)
                .py(8.0)
                .center()
                .on_layout(|s: &mut State, _| {
                    let offset =
                        f32::from_bits(s.ledger_offset.load(std::sync::atomic::Ordering::Relaxed));
                    if offset <= LEDGER_TOP_SLACK
                        && s.ledger_hand_scrolled
                            .swap(false, std::sync::atomic::Ordering::Relaxed)
                    {
                        s.load_older();
                    }
                })
                .child(older_loader(s, &k)),
        );
    }
    if let Some(results) = &s.search_results {
        ledger = ledger.child(
            rune::row()
                .key("search-header")
                .w_full()
                .px(16.0)
                .py(8.0)
                .gap(8.0)
                .center_y()
                .child(
                    text(format!(
                        "{} results for “{}”",
                        results.len(),
                        s.search.text.trim()
                    ))
                    .font(k.ty.small_medium)
                    .color(c.text_muted)
                    .grow(1.0),
                )
                .child(
                    IconButton::new(&icons::X)
                        .label("Clear search")
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press(|s: &mut State| s.search_results = None)
                        .build(&k)
                        .key("search-clear"),
                ),
        );
    }
    let posts = s.search_results.as_ref().unwrap_or(&s.posts);
    ledger = ledger.child(
        col()
            .key("ledger-rows")
            .w_full()
            .growth(rune::GrowthSpec::default())
            .virtual_rows(
                posts.len(),
                72.0,
                |s: &State, i| {
                    let posts = s.search_results.as_ref().unwrap_or(&s.posts);
                    format!("post-{}", posts[i].id).into()
                },
                |s: &State, i| post_row(s, i),
            )
            .on_visible_rows(|s: &mut State, visible| {
                let posts = s.search_results.as_ref().unwrap_or(&s.posts);
                let open = s
                    .emoji_picker
                    .clone()
                    .map(|id| (id, true))
                    .or_else(|| s.image_menu.clone().map(|id| (id, false)));
                let Some((id, is_picker)) = open else {
                    return false;
                };
                match posts.iter().position(|p| p.id == id) {
                    Some(index) if !visible.contains(&index) => {
                        if is_picker {
                            s.emoji_picker = None;
                        } else {
                            s.image_menu = None;
                        }
                        true
                    }
                    _ => false,
                }
            }),
    );
    let (composer, toolbar) = crate::composer::composer(s, composer_locked);
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
                .fill(c.layer_01)
                .child(tab_strip(s, &mut layer)),
        );
    let channel_name = s
        .channel
        .as_deref()
        .and_then(|id| s.channels.iter().find(|c| c.id == id))
        .map(|c| c.display_name.clone())
        .unwrap_or_default();
    if !searching {
        main = main.child(
            rune::row()
                .w_full()
                .px(16.0)
                .pt(8.0)
                .center_y()
                .fill(c.layer_01)
                .child(
                    text(channel_name)
                        .font(k.ty.body_medium)
                        .color(c.text_base)
                        .grow(1.0)
                        .min_w(0.0)
                        .truncate(),
                )
                .child(member_stack(s, &k))
                .child(
                    IconButton::new(&icons::FOLDER)
                        .label(if s.channel_files {
                            "Close channel files"
                        } else {
                            "Show channel files"
                        })
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press(|s: &mut State| {
                            s.channel_files = !s.channel_files;
                            if s.channel_files {
                                s.fetch_channel_files();
                            }
                        })
                        .build(&k)
                        .key("channel-files-toggle")
                        .expanded(s.channel_files)
                        .ml(8.0)
                        .help(if s.channel_files {
                            "Close channel files"
                        } else {
                            "Show channel files"
                        }),
                ),
        );
    }
    let actions = rune::row().w_full().gap(8.0).flex_wrap();
    main = main.child(col().w_full().px(16.0).pb(8.0).gap(4.0).child(actions));
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
        status = status.child(text(error).color(c.warning.fg).wrap()).child(
            button("reload", "Reload", s.busy, |s| {
                if s.dispatch(Intent::Refresh) {
                    s.ready = false;
                    s.error = None;
                }
            })
            .self_start(),
        );
    }
    if s.recovered_pending
        || s.checkpoint_retry.is_some()
        || s.pending.is_some()
        || s.error.is_some()
    {
        main = main.child(status);
    }
    if s.channel.is_none() && !searching {
        ledger = ledger.child(
            rune::row().w_full().pt(24.0).center().child(
                text(EMPTY_ART.trim_end())
                    .font(k.ty.mono.family(rune::Family::SystemMono))
                    .color(c.text_faint)
                    .a11y_hidden(),
            ),
        );
    }
    let mut timeline = col()
        .grow(1.0)
        .min_h(0.0)
        .child(ledger.scroll_bar_styled(ScrollBarStyle::scroll_view(&k)));
    if !searching {
        timeline = timeline.children(
            typing_indicator(s, &k).map(|pill| pill.pin(Some(16.0), None, None, Some(8.0))),
        );
    }
    main = main.child(timeline);
    if !searching {
        main = main
            .on_drop_files(|s: &mut State, files, _| s.attach(files))
            .child(
                col()
                    .key("composer-bar")
                    .w_full()
                    .px(16.0)
                    .py(8.0)
                    .gap(8.0)
                    .fill(c.layer_01)
                    .children(reply_chip(s, &k))
                    .children(edit_chip(s, &k))
                    .children(attachment_pills(s, &k))
                    .child(composer)
                    .child(
                        rune::row()
                            .w_full()
                            .gap(8.0)
                            .center_y()
                            .child(toolbar)
                            .child(attach_button(
                                &k,
                                "attach-image",
                                "Attach image",
                                &icons::IMAGE,
                                true,
                                composer_locked,
                            ))
                            .child(attach_button(
                                &k,
                                "attach-file",
                                "Attach file",
                                &icons::PAPERCLIP,
                                false,
                                composer_locked,
                            ))
                            .child({
                                let no_key = s.giphy_key.is_none();
                                let b = IconButton::new(&icons::GIF)
                                    .label("Search GIFs")
                                    .control_size(ControlSize::Small)
                                    .variant(IconButtonVariant::Ghost)
                                    .disabled(composer_locked || no_key)
                                    .on_press(|s: &mut State| s.open_gif_picker())
                                    .build(&k)
                                    .key("gif-picker-open")
                                    .expanded(s.gif_picker);
                                if composer_locked || no_key {
                                    b.inert()
                                } else {
                                    b
                                }
                            })
                            .child({
                                let disabled = composer_locked
                                    || s.channel.is_none()
                                    || (s.markdown().trim().is_empty() && s.attachments.is_empty());
                                let send = Button::new("Send")
                                    .variant(ButtonVariant::Contrast)
                                    .disabled(disabled)
                                    .on_press_tx(|s: &mut State, tx| {
                                        s.send();
                                        tx.focus("draft", false);
                                    })
                                    .build(&k)
                                    .key("send");
                                if disabled { send.inert() } else { send }
                            }),
                    ),
            );
    }
    if let Some(post) = s
        .emoji_picker
        .as_deref()
        .and_then(|id| posts.iter().find(|p| p.id == id))
    {
        emoji_picker(s, post, &k, &mut layer);
    }
    if let Some(post) = s
        .image_menu
        .as_deref()
        .and_then(|id| posts.iter().find(|p| p.id == id))
    {
        image_menu(s, post, &k, &mut layer);
    }
    let body = rune::row()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(sidebar)
        .child(grip)
        .child(main)
        .children(if s.thread.is_some() {
            let width = s.thread_panel.width();
            let grip = el()
                .key("thread-grip")
                .role("separator")
                .label("Resize thread panel")
                .range_value(
                    f64::from(width),
                    f64::from(s.thread_panel.min_width()),
                    f64::from(s.thread_panel.max_width()),
                )
                .range_step(8.0)
                .w(1.0)
                .h_full()
                .cursor(rune::Cursor::ResizeColumn)
                .fill(c.border_base)
                .on_drag(|s: &mut State, d: &mut rune::Drag, _| match d.phase {
                    rune::Phase::Down => d.data = s.thread_panel.width(),
                    rune::Phase::Move => s.thread_panel.drag_to(d.data - d.dx),
                    rune::Phase::Up => {}
                });
            vec![grip, thread_panel(s, composer_locked, &k)]
        } else {
            Vec::new()
        })
        .children(s.channel_files.then(|| channel_files_panel(s, &k)));
    rune_kit::root(body, layer)
}
