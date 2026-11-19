use super::*;

pub(super) fn first_line(message: &str) -> String {
    message.lines().next().unwrap_or_default().trim().to_owned()
}

pub(super) fn count_badge(key: String, count: u64, size: f32, k: &rune_kit::Kit) -> El {
    hbox()
        .key(key)
        .a11y_hidden()
        .h(size)
        .min_w(size)
        .px(6.0)
        .center()
        .radius(size / 2.0)
        .fill(k.c.bg_inverse)
        .child(
            text(count.to_string())
                .font(k.ty.small_medium)
                .color(k.c.text_inverse),
        )
}

pub(super) fn thread_row(s: &State, thread: &ThreadPreview, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let id = thread.id.clone();
    let title = first_line(&thread.root_message);
    let body = thread
        .root_message
        .lines()
        .skip(1)
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_owned);
    let author = s
        .names
        .get(&thread.reply_user_id)
        .unwrap_or(&thread.reply_user_id)
        .clone();
    let reply = first_line(&thread.reply_message);
    let mut lines = col().grow(1.0).shrink().min_w(0.0).gap(2.0).child(
        text(title.clone())
            .font(TextStyle {
                weight: 600.0,
                ..k.ty.small
            })
            .color(c.text_base)
            .truncate()
            .a11y_hidden(),
    );
    if let Some(body) = body {
        lines = lines.child(
            hbox()
                .gap(6.0)
                .center_y()
                .child(
                    icon(&TEXT_ALIGN_LEFT, 12.0)
                        .color(c.icon_faint)
                        .a11y_hidden(),
                )
                .child(
                    text(body)
                        .font(k.ty.small)
                        .color(c.text_muted)
                        .truncate()
                        .shrink()
                        .a11y_hidden(),
                ),
        );
    }
    lines = lines.child(
        hbox()
            .gap(6.0)
            .center_y()
            .child(icon(&ARROW_ELBOW, 12.0).color(c.icon_muted).a11y_hidden())
            .child(
                text(author.clone())
                    .font(k.ty.small_medium)
                    .color(c.text_base)
                    .a11y_hidden(),
            )
            .child(
                text(reply.clone())
                    .font(k.ty.small)
                    .color(c.text_base)
                    .truncate()
                    .shrink()
                    .a11y_hidden(),
            ),
    );
    let row = hbox()
        .key(format!("thread-{}", thread.id))
        .role("button")
        .label(format!("Open thread {title}: {author} {reply}"))
        .w_full()
        .pl(10.0)
        .pr(8.0)
        .py(6.0)
        .gap(8.0)
        .radius(k.radius.md)
        .motion(k.motion.control)
        .hover_group()
        .hover_motion(rune::Anim::INSTANT, rune::Anim::INSTANT)
        .focusable(true)
        .child(lines);
    k.interactive(row)
        .on_press_tx(move |s: &mut State, tx| s.open_thread(&id, tx))
}

pub(super) fn threads_section(s: &State, k: &rune_kit::Kit) -> Option<El> {
    if s.threads.is_empty() {
        return None;
    }
    let c = &k.c;
    let mut channels: Vec<&str> = Vec::new();
    for thread in &s.threads {
        if !channels.contains(&thread.channel_id.as_str()) {
            channels.push(&thread.channel_id);
        }
    }
    let mut group = col()
        .key("threads")
        .role("group")
        .label("Threads")
        .w_full()
        .gap(8.0);
    for channel in channels {
        let threads: Vec<&ThreadPreview> = s
            .threads
            .iter()
            .filter(|t| t.channel_id == channel)
            .collect();
        let name = s
            .channels
            .iter()
            .find(|c| c.id == channel)
            .map_or(channel, |c| c.display_name.as_str());
        let total: u64 = threads
            .iter()
            .map(|t| t.unread_replies.max(t.unread_mentions))
            .sum();
        group = group.child(
            col()
                .key(format!("threads-{channel}"))
                .w_full()
                .px(ROW_GUTTER)
                .gap(2.0)
                .child(
                    hbox()
                        .w_full()
                        .px(4.0)
                        .py(4.0)
                        .gap(8.0)
                        .center_y()
                        .child(
                            text(name.to_owned())
                                .font(k.ty.ui)
                                .color(c.text_base)
                                .truncate()
                                .grow(1.0)
                                .shrink(),
                        )
                        .child(count_badge(
                            format!("threads-total-{channel}"),
                            total,
                            20.0,
                            k,
                        )),
                )
                .child(
                    hbox()
                        .w_full()
                        .gap(0.0)
                        .child(el().w(1.0).fill(c.border_muted).a11y_hidden())
                        .child(
                            col()
                                .grow(1.0)
                                .shrink()
                                .min_w(0.0)
                                .gap(2.0)
                                .children(threads.into_iter().map(|t| thread_row(s, t, k))),
                        ),
                ),
        );
    }
    Some(group)
}

pub(super) fn team_label(team: &Team) -> String {
    if team.display_name.is_empty() {
        team.name.clone()
    } else {
        team.display_name.clone()
    }
}

pub(super) fn member_stack(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let mut stack = rune::row().gap(-6.0).center_y();
    for user_id in s.members.iter().take(5) {
        let dot = presence_dot(s.peer_presence.get(user_id).map(String::as_str), c);
        let avatar = match s.avatars.user(user_id) {
            Some(image) => el()
                .size(24.0, 24.0)
                .radius(12.0)
                .border(1.5, c.bg_base)
                .pixels(image.pixels()),
            None => el()
                .size(24.0, 24.0)
                .radius(12.0)
                .border(1.5, c.bg_base)
                .fill(c.layer_02),
        };
        stack = stack.child(
            el().size(24.0, 24.0).child(avatar).child(
                el().key("status-dot")
                    .size(6.0, 6.0)
                    .radius(3.0)
                    .fill(dot)
                    .absolute(18.0, 18.0)
                    .a11y_hidden(),
            ),
        );
    }
    let mut group = rune::row().gap(6.0).center_y().child(stack);
    if s.members.len() > 1 {
        group = group.child(
            text(s.members.len().to_string())
                .font(k.ty.small)
                .color(c.text_muted)
                .a11y_hidden(),
        );
    }
    let mut names: Vec<String> = s
        .members
        .iter()
        .map(|id| s.names.get(id).cloned().unwrap_or_else(|| id.clone()))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    let group = group.key("members");
    if names.is_empty() {
        group
    } else {
        group.help(names.join("\n"))
    }
}

pub(super) fn user_avatar(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let me = s.authenticated.as_ref();
    let dot = presence_dot(Some(s.presence.as_str()), c);
    let image = me.and_then(|key| s.avatars.user(key.user_id()));
    let mut avatar = rune::row()
        .key("user-avatar")
        .role("img")
        .label(format!("Your status: {}", s.presence))
        .size(24.0, 24.0)
        .radius(12.0)
        .fill(c.layer_02)
        .center();
    avatar = match image {
        Some(image) => avatar.child(
            el().size(24.0, 24.0)
                .radius(12.0)
                .pixels(image.pixels())
                .a11y_hidden(),
        ),
        None => avatar.child(
            el().size(24.0, 24.0)
                .radius(12.0)
                .fill(c.layer_02)
                .a11y_hidden(),
        ),
    };
    avatar.child(
        el().key("status-dot")
            .size(8.0, 8.0)
            .radius(4.0)
            .fill(dot)
            .absolute(16.0, 16.0)
            .a11y_hidden(),
    )
}

pub(super) fn server_menu(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) -> El {
    let names: Vec<String> = s.teams.iter().map(team_label).collect();
    let current_id = s.current_team_id();
    let current = s
        .teams
        .iter()
        .position(|team| current_id.as_deref() == Some(team.id.as_str()))
        .map(|i| names[i].clone())
        .unwrap_or_default();
    let trigger = Select::new("server", &names)
        .current(Some(&current))
        .appearance(SelectAppearance::Inline)
        .open(s.server_open)
        .on_toggle(|s: &mut State| s.server_open = !s.server_open)
        .trigger(k)
        .max_w(SERVER_MAX_WIDTH)
        .h(24.0);
    let mut menu = rune_kit::Menu::new("server-menu")
        .trigger(trigger)
        .open(s.server_open)
        .on_close(|s: &mut State| s.server_open = false);
    for (i, name) in names.iter().enumerate() {
        menu = menu.item(
            MenuItem::new(name.clone())
                .checked(*name == current)
                .on_select(move |s: &mut State| {
                    s.server_open = false;
                    if let Some(team) = s.teams.get(i) {
                        s.selected_team = Some(team.id.clone());
                    }
                }),
        );
    }
    menu.build(k, layer)
}

pub(super) fn section(
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

pub(super) fn dm_peer<'a>(s: &State, name: &'a str) -> Option<&'a str> {
    let me = s.authenticated.as_ref()?.user_id();
    name.split("__")
        .find(|id| *id != me && !id.is_empty())
        .or_else(|| name.split("__").find(|id| *id == me))
}

pub(super) fn search_filters(s: &State, k: &rune_kit::Kit) -> El {
    use antimatter_services::mattermost::ThreadScope;
    const SCOPES: [(&str, ThreadScope); 3] = [
        ("All", ThreadScope::All),
        ("Roots", ThreadScope::Roots),
        ("Replies", ThreadScope::Replies),
    ];
    let labels: Vec<&str> = SCOPES.iter().map(|(label, _)| *label).collect();
    let picked = SCOPES
        .iter()
        .position(|(_, scope)| *scope == s.search_filters.thread_scope);
    col()
        .key("search-filters")
        .w_full()
        .px(8.0)
        .pb(6.0)
        .gap(6.0)
        .child(
            Segments::new(&labels, picked)
                .label("Thread scope")
                .width(None)
                .font(k.ty.small)
                .on_pick(|s: &mut State, i, _| s.search_filters.thread_scope = SCOPES[i].1)
                .build(k)
                .key("search-filter-scope"),
        )
        .child(
            rune_kit::TextInput::new(&s.search_channel)
                .label("Channel")
                .placeholder("Channel")
                .width(None)
                .text_style(k.ty.small)
                .height(28.0)
                .on_edit(|s: &mut State| &mut s.search_channel)
                .on_submit(|s: &mut State, _| s.run_search())
                .build(k)
                .key("search-filter-channel"),
        )
        .child(
            rune_kit::TextInput::new(&s.search_sender)
                .label("Sender")
                .placeholder("Sender username")
                .width(None)
                .text_style(k.ty.small)
                .height(28.0)
                .on_edit(|s: &mut State| &mut s.search_sender)
                .on_submit(|s: &mut State, _| s.run_search())
                .build(k)
                .key("search-filter-sender"),
        )
        .child(
            rune_kit::TextInput::new(&s.search_after)
                .label("After")
                .placeholder("After YYYY-MM-DD")
                .width(None)
                .text_style(k.ty.small)
                .height(28.0)
                .on_edit(|s: &mut State| &mut s.search_after)
                .on_submit(|s: &mut State, _| s.run_search())
                .build(k)
                .key("search-filter-after"),
        )
        .child(
            rune_kit::TextInput::new(&s.search_before)
                .label("Before")
                .placeholder("Before YYYY-MM-DD")
                .width(None)
                .text_style(k.ty.small)
                .height(28.0)
                .on_edit(|s: &mut State| &mut s.search_before)
                .on_submit(|s: &mut State, _| s.run_search())
                .build(k)
                .key("search-filter-before"),
        )
        .child(switch_row(
            "search-filter-files",
            "Has files",
            s.search_filters.has_files,
            |s: &mut State| s.search_filters.has_files = !s.search_filters.has_files,
            k,
        ))
        .child(switch_row(
            "search-filter-pinned",
            "Pinned only",
            s.search_filters.pinned_only,
            |s: &mut State| s.search_filters.pinned_only = !s.search_filters.pinned_only,
            k,
        ))
        .child(switch_row(
            "search-filter-saved",
            "Saved only",
            s.search_filters.saved_only,
            |s: &mut State| s.search_filters.saved_only = !s.search_filters.saved_only,
            k,
        ))
        .child(
            rune_kit::TextInput::new(&s.search_extension)
                .label("File extension")
                .placeholder("File extension")
                .width(None)
                .text_style(k.ty.small)
                .height(28.0)
                .on_edit(|s: &mut State| &mut s.search_extension)
                .on_submit(|s: &mut State, _| s.run_search())
                .build(k)
                .key("search-filter-extension"),
        )
}

pub(super) fn channel_row(s: &State, channel: &Channel, locked: bool, k: &rune_kit::Kit) -> El {
    let id = channel.id.clone();
    let unread = s.unread.get(&channel.id).copied().unwrap_or_default();
    let selected = s.channel.as_deref() == Some(&channel.id);
    let has_unread = unread.mentions > 0 || unread.messages > 0;
    let (ink, glyph) = if selected {
        (k.c.text_base, k.c.icon_base)
    } else if has_unread {
        (k.c.text_base, k.c.icon_muted)
    } else {
        (k.c.text_muted, k.c.icon_muted)
    };
    let title = TextStyle {
        weight: if has_unread { 600.0 } else { 400.0 },
        ..k.ty.small
    };
    let mut lead = Vec::new();
    if !matches!(channel.kind.as_str(), "D" | "G") {
        lead.push(
            icon(&icons::HASH, 16.0)
                .key("icon")
                .color(glyph)
                .a11y_hidden(),
        );
    }
    if channel.kind == "G" && !channel.members.is_empty() {
        let mut stack = rune::row().gap(-8.0).center_y();
        for member in channel.members.iter().take(3) {
            let face = match s.avatars.user(member) {
                Some(image) => el()
                    .size(18.0, 18.0)
                    .radius(9.0)
                    .border(1.5, k.c.layer_01)
                    .pixels(image.pixels()),
                None => el()
                    .size(18.0, 18.0)
                    .radius(9.0)
                    .border(1.5, k.c.layer_01)
                    .fill(k.c.layer_03),
            };
            stack = stack.child(face);
        }
        lead.push(stack.key("avatar-stack").a11y_hidden());
    }
    if channel.kind == "D"
        && let Some(peer) = dm_peer(s, &channel.name)
    {
        let dot = presence_dot(s.peer_presence.get(peer).map(String::as_str), &k.c);
        let avatar = match s.avatars.user(peer) {
            Some(image) => el().size(22.0, 22.0).radius(11.0).pixels(image.pixels()),
            None => el().size(22.0, 22.0).radius(11.0).fill(k.c.layer_02),
        };
        lead.push(
            hbox()
                .key("avatar")
                .size(22.0, 22.0)
                .center()
                .child(
                    el().size(22.0, 22.0).child(avatar).child(
                        el().size(8.0, 8.0)
                            .radius(4.0)
                            .fill(dot)
                            .absolute(14.0, 14.0),
                    ),
                )
                .a11y_hidden(),
        );
    }
    let mut row = hbox()
        .label(&channel.display_name)
        .w_full()
        .h(28.0)
        .pl(8.0 + 16.0)
        .pr(8.0)
        .gap(6.0)
        .center_y()
        .radius(k.radius.md)
        .motion(k.motion.control)
        .hover_group()
        .hover_motion(rune::Anim::INSTANT, rune::Anim::INSTANT)
        .focusable(true)
        .focus_selected(selected);
    row = k.interactive(row);
    if selected {
        row = row.fill(k.c.pressed);
    }
    row = row.children(lead).child(
        text(channel.display_name.clone())
            .key("label")
            .font(title)
            .color(ink)
            .truncate()
            .grow(1.0)
            .shrink()
            .a11y_hidden(),
    );
    if unread.mentions > 0 {
        row = row.child(
            hbox()
                .a11y_hidden()
                .key("badge")
                .h(16.0)
                .px(5.0)
                .center()
                .radius(8.0)
                .fill(k.c.layer_03)
                .child(
                    text(format!("@{}", unread.mentions))
                        .font(k.ty.small_medium)
                        .color(k.c.text_muted),
                ),
        );
    } else if unread.messages > 0 {
        row = row.child(
            el().key("status")
                .size(7.0, 7.0)
                .radius(3.5)
                .fill(k.c.bg_accent)
                .a11y_hidden(),
        );
    }
    let open = channel.id.clone();
    let row = row
        .on_press_tx(move |s: &mut State, _| {
            if !locked {
                s.load(id.clone());
            }
        })
        .on_double_press_tx(move |s: &mut State, _| s.open_durable(open.clone()))
        .role("listitem")
        .key(format!("channel-{}", channel.id));
    let menu = channel.id.clone();
    rune::row()
        .w_full()
        .px(ROW_GUTTER)
        .on_secondary_press(move |s: &mut State, p, _| {
            if !locked {
                s.channel_menu = Some((menu.clone(), p));
            }
        })
        .child(row)
}
