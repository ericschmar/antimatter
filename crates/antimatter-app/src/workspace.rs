use crate::state::*;
use crate::tabs::tab_strip;
use crate::theme::workspace_theme;
use crate::widgets::*;
use antimatter_services::accounts::Account;
use antimatter_services::conversation::Intent;
use antimatter_services::mattermost::{Channel, Post};
use antimatter_services::settings::MessageSpacing;
use antimatter_theme::icons;
use rune::{El, Icon, TextStyle, col, el, icon, row as hbox, text};
use rune_kit::{
    ButtonVariant, ControlSize, Highlight, IconButton, IconButtonVariant, Markdown, MarkdownStyle,
    MenuItem, ScrollBar, Select, SelectAppearance,
};

pub(crate) const TITLEBAR: f32 = 40.0;
const TRAFFIC_LIGHTS: f32 = 84.0;
const SERVER_MAX_WIDTH: f32 = 160.0;
const MAIN_MIN: f32 = 248.0;
const SECTION_HEADER_HEIGHT: f32 = 24.0;
const ROW_GUTTER: f32 = 6.0;

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

const LEDGER_TOP_SLACK: f32 = 24.0;

pub(crate) fn post_padding(spacing: MessageSpacing) -> f32 {
    match spacing {
        MessageSpacing::Small => 4.0,
        MessageSpacing::Medium => 8.0,
        MessageSpacing::Large => 12.0,
    }
}

fn older_loader(s: &State, k: &rune_kit::Kit) -> El {
    if !s.loading_older {
        return el().h(0.0);
    }
    rune::icon(&antimatter_theme::loader::SPINNER, 16.0)
        .color(k.c.icon_muted)
        .looping(rune::LoopSpec::rotation(0.9))
        .label("Loading older messages")
        .role("progressbar")
}

fn post_day(create_at: i64) -> Option<chrono::NaiveDate> {
    chrono::DateTime::from_timestamp_millis(create_at)
        .map(|at| at.with_timezone(&chrono::Local).date_naive())
}

fn post_time(create_at: i64) -> String {
    chrono::DateTime::from_timestamp_millis(create_at)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%-I:%M %P")
                .to_string()
        })
        .unwrap_or_default()
}

fn presence_dot(status: Option<&str>, c: &rune_kit::Palette) -> rune::Color {
    match status {
        Some("online") => c.success.icon,
        Some("away") | Some("dnd") => c.warning.icon,
        _ => c.icon_muted,
    }
}

fn author_marker(s: &State, post: &Post, c: &rune_kit::Palette) -> El {
    let dot = presence_dot(s.peer_presence.get(&post.user_id).map(String::as_str), c);
    if !s.show_timeline_avatars {
        return el().size(6.0, 6.0).radius(3.0).fill(dot);
    }
    let avatar = match s.avatars.get(&post.user_id) {
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
    el().size(24.0, 24.0).child(avatar).child(
        el().key("status-dot")
            .size(6.0, 6.0)
            .radius(3.0)
            .fill(dot)
            .absolute(18.0, 18.0)
            .a11y_hidden(),
    )
}

fn emoji_glyph(name: &str) -> String {
    match name {
        "+1" | "thumbsup" => "👍",
        "-1" | "thumbsdown" => "👎",
        "heart" => "❤️",
        "smile" => "😄",
        "joy" => "😂",
        "tada" => "🎉",
        "eyes" => "👀",
        "pray" => "🙏",
        "fire" => "🔥",
        "white_check_mark" => "✅",
        "100" => "💯",
        "rocket" => "🚀",
        _ => return format!(":{name}:"),
    }
    .into()
}

fn reaction_pills(s: &State, post: &Post, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let me = s.authenticated.as_ref().map(|key| key.user_id());
    let mut groups: Vec<(&str, usize, bool)> = Vec::new();
    for r in &post.metadata.reactions {
        let mine = me == Some(r.user_id.as_str());
        match groups.iter_mut().find(|g| g.0 == r.emoji_name) {
            Some(g) => {
                g.1 += 1;
                g.2 |= mine;
            }
            None => groups.push((&r.emoji_name, 1, mine)),
        }
    }
    let mut pills = rune::row().gap(4.0).flex_wrap();
    for (name, count, mine) in groups {
        pills = pills.child(
            rune::row()
                .key(format!("reaction-{}-{name}", post.id))
                .role("img")
                .label(format!("{name} {count}"))
                .h(22.0)
                .px(8.0)
                .gap(4.0)
                .center_y()
                .radius(11.0)
                .fill(c.layer_02)
                .border(1.0, if mine { c.bg_accent } else { c.border_base })
                .child(text(emoji_glyph(name)).font(k.ty.small).a11y_hidden())
                .child(
                    text(count.to_string())
                        .font(k.ty.small)
                        .color(c.text_muted)
                        .a11y_hidden(),
                ),
        );
    }
    pills
}

fn mentions(message: &str, me: Option<&str>) -> Vec<(std::ops::Range<usize>, bool)> {
    let mut out = Vec::new();
    for (start, _) in message.match_indices('@') {
        if message[..start]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '@')
        {
            continue;
        }
        let word: String = message[start + 1..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-'))
            .collect();
        let word = word.trim_end_matches(['.', '-']);
        let end = start + 1 + word.len();
        if word == "here" {
            out.push((start..end, false));
        } else if !word.is_empty() && me.is_some_and(|m| m.eq_ignore_ascii_case(word)) {
            out.push((start..end, true));
        }
    }
    out
}

fn member_stack(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let mut stack = rune::row().gap(-6.0).center_y();
    for user_id in s.members.iter().take(5) {
        let dot = match s.peer_presence.get(user_id).map(String::as_str) {
            Some("online") => c.success.icon,
            Some("away") | Some("dnd") => c.warning.icon,
            _ => c.icon_muted,
        };
        let avatar = match s.avatars.get(user_id) {
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
    group
}

fn user_avatar(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let me = s.authenticated.as_ref();
    let dot = match s.presence.as_str() {
        "online" => c.success.icon,
        "away" | "dnd" => c.warning.icon,
        _ => c.icon_muted,
    };
    let image = me.and_then(|key| s.avatars.get(key.user_id()));
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

fn server_menu(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) -> El {
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

fn dm_peer<'a>(s: &State, name: &'a str) -> Option<&'a str> {
    let me = s.authenticated.as_ref()?.user_id();
    name.split("__")
        .find(|id| *id != me && !id.is_empty())
        .or_else(|| name.split("__").find(|id| *id == me))
}

fn channel_row(s: &State, channel: &Channel, locked: bool, k: &rune_kit::Kit) -> El {
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
    if channel.kind == "D"
        && let Some(peer) = dm_peer(s, &channel.name)
    {
        let dot = match s.peer_presence.get(peer).map(String::as_str) {
            Some("online") => k.c.success.icon,
            Some("away") | Some("dnd") => k.c.warning.icon,
            _ => k.c.icon_muted,
        };
        let avatar = match s.avatars.get(peer) {
            Some(image) => el().size(16.0, 16.0).radius(8.0).pixels(image.pixels()),
            None => el().size(16.0, 16.0).radius(8.0).fill(k.c.layer_02),
        };
        lead.push(
            hbox()
                .key("avatar")
                .size(16.0, 16.0)
                .center()
                .child(
                    el().size(16.0, 16.0).child(avatar).child(
                        el().size(6.0, 6.0)
                            .radius(3.0)
                            .fill(dot)
                            .absolute(10.0, 10.0),
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
        .on_double_press_tx(move |s: &mut State, _| {
            if !locked {
                s.open_durable(open.clone());
            }
        })
        .role("listitem")
        .key(format!("channel-{}", channel.id));
    let row = if locked {
        row.disabled(true).inert()
    } else {
        row
    };
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

pub(crate) fn workspace(s: &State) -> El {
    let mut layer = Vec::new();
    let k = workspace_theme();
    let c = &k.c;
    let locked = !s.ready || s.busy || s.submitted || s.recovered_pending || s.pending.is_some();
    let (direct, regular): (Vec<_>, Vec<_>) = s
        .channels
        .iter()
        .partition(|channel| matches!(channel.kind.as_str(), "D" | "G"));
    let (archived, regular): (Vec<_>, Vec<_>) = regular
        .into_iter()
        .partition(|channel| s.navigation.archived.contains(&channel.id));
    let (favorites, regular): (Vec<_>, Vec<_>) = regular
        .into_iter()
        .partition(|channel| s.navigation.favorites.contains(&channel.id));
    let point = s.channel_menu.clone();
    let channel = point.as_ref().map(|(id, _)| id.clone()).unwrap_or_default();
    let favorite = s.navigation.favorites.contains(&channel);
    let archive = s.navigation.archived.contains(&channel);
    let channel_menu =
        rune_kit::context_menu("channel-menu", el().w(0.0).h(0.0), point.map(|(_, p)| p))
            .on_close(|s: &mut State| s.channel_menu = None)
            .item({
                let channel = channel.clone();
                MenuItem::new(if favorite { "Unfavorite" } else { "Favorite" }).on_select(
                    move |s: &mut State| {
                        s.channel_menu = None;
                        s.toggle_favorite(&channel);
                    },
                )
            })
            .item({
                let channel = channel.clone();
                MenuItem::new(if archive { "Unarchive" } else { "Archive" }).on_select(
                    move |s: &mut State| {
                        s.channel_menu = None;
                        s.toggle_archived(&channel);
                    },
                )
            })
            .build(&k, &mut layer);
    let mut sidebar = col().w_full().gap(8.0);
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
    sidebar = sidebar.child(section(
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
                        .caret(c.text_base, k.selection())
                        .on_edit(|s: &mut State| &mut s.search),
                ),
        )
        .child(
            sidebar
                .key("sidebar-channels")
                .grow(1.0)
                .min_h(0.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .scroll_bar(&k),
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
        .w(2.0)
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
    let mut ledger = col()
        .key("timeline")
        .grow(1.0)
        .min_h(0.0)
        .scroll(rune::ScrollSpec { stick_bottom: true })
        .scroll_anchor()
        .on_scroll_offset(move |at| {
            offset.store(at.offset[1].to_bits(), std::sync::atomic::Ordering::Relaxed);
            if rune::scroll_watch_state().0 {
                hand_scrolled.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        });
    if s.has_older {
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
    let mut previous_day = None;
    for post in &s.posts {
        let day = post_day(post.create_at);
        if day != previous_day
            && let Some(day) = day
        {
            ledger = ledger.child(
                rune::row()
                    .w_full()
                    .px(16.0)
                    .py(8.0)
                    .gap(8.0)
                    .center_y()
                    .child(el().grow(1.0).h(1.0).fill(c.border_muted))
                    .child(
                        text(day.format("%B %-d, %Y").to_string())
                            .font(k.ty.small)
                            .color(c.text_muted),
                    )
                    .child(el().grow(1.0).h(1.0).fill(c.border_muted)),
            );
        }
        previous_day = day;
        let line = f32::from(s.message_font_size) * 1.6;
        ledger = ledger.child(
            rune::row()
                .key(format!("post-{}", post.id))
                .w_full()
                .gap(8.0)
                .px(16.0)
                .py(post_padding(s.message_spacing))
                .hover(c.hover)
                .hover_group()
                .child(
                    rune::row()
                        .w(120.0)
                        .h(line)
                        .shrink()
                        .gap(6.0)
                        .center_y()
                        .child(author_marker(s, post, c))
                        .child(
                            text(s.names.get(&post.user_id).unwrap_or(&post.user_id))
                                .shrink()
                                .font(k.ty.small)
                                .color(c.text_muted)
                                .truncate(),
                        ),
                )
                .child(
                    rune::row().h(line).center_y().shrink().child(
                        text(post_time(post.create_at))
                            .font(k.ty.small)
                            .color(c.text_muted)
                            .shrink(),
                    ),
                )
                .child(
                    col()
                        .grow(1.0)
                        .shrink()
                        .min_w(0.0)
                        .gap(4.0)
                        .child(
                            Markdown::new(&post.message)
                                .highlights(
                                    mentions(&post.message, s.my_username())
                                        .into_iter()
                                        .map(|(range, me)| {
                                            let bg = if me { c.bg_accent } else { c.warning.icon };
                                            (range, Highlight::new().bg(bg).fg(c.bg_base))
                                        })
                                        .collect::<Vec<_>>(),
                                )
                                .style(MarkdownStyle::from_kit(&k).body_font(TextStyle {
                                    size: f32::from(s.message_font_size),
                                    line_height: f32::from(s.message_font_size) * 1.6,
                                    ..k.ty.ui
                                }))
                                .build(&k),
                        )
                        .child(reaction_pills(s, post, &k)),
                )
                .child(
                    rune::row()
                        .key("post-actions")
                        .gap(2.0)
                        .padding(2.0)
                        .radius(6.0)
                        .fill(c.layer_02)
                        .border(1.0, c.border_base)
                        .pin(None, Some(-6.0), Some(16.0), None)
                        .group_opacity(0.0, 1.0)
                        .child(
                            IconButton::new(&icons::ARROW_BEND_UP_LEFT)
                                .label("Reply")
                                .control_size(ControlSize::Small)
                                .variant(IconButtonVariant::Ghost)
                                .build(&k)
                                .key("post-reply"),
                        )
                        .child(
                            IconButton::new(&icons::SMILEY)
                                .label("Add reaction")
                                .control_size(ControlSize::Small)
                                .variant(IconButtonVariant::Ghost)
                                .build(&k)
                                .key("post-react"),
                        ),
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
                .child(tab_strip(s, &mut layer)),
        );
    let channel_name = s
        .channel
        .as_deref()
        .and_then(|id| s.channels.iter().find(|c| c.id == id))
        .map(|c| c.display_name.clone())
        .unwrap_or_default();
    main = main.child(
        rune::row()
            .w_full()
            .px(16.0)
            .pt(8.0)
            .center_y()
            .child(
                text(channel_name)
                    .font(k.ty.body_medium)
                    .color(c.text_base)
                    .grow(1.0)
                    .min_w(0.0)
                    .truncate(),
            )
            .child(member_stack(s, &k)),
    );
    let mut actions = rune::row().w_full().gap(8.0).flex_wrap();
    if s.durable.is_some() {
        actions = actions.child(button(
            "save-draft",
            "Save draft",
            s.busy || s.submitted || s.pending.is_some() || s.recovered_pending,
            |s| s.checkpoint(AfterCheckpoint::Save),
        ));
    }
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
    main = main.child(ledger.scroll_bar(&k)).child(
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

#[cfg(test)]
mod mention_tests {
    use super::mentions;

    #[test]
    fn finds_here_and_me_only_at_word_starts() {
        let m = "@here hi @Ada, not a@ada or @bob";
        assert_eq!(mentions(m, Some("ada")), vec![(0..5, false), (9..13, true)]);
    }
}
