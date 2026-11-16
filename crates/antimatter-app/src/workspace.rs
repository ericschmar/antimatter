use crate::state::*;
use crate::tabs::tab_strip;
use crate::theme::workspace_theme;
use crate::widgets::*;
use antimatter_services::accounts::Account;
use antimatter_services::conversation::{Intent, ThreadPreview};
use antimatter_services::mattermost::{Channel, Post};
use antimatter_services::settings::MessageSpacing;
use antimatter_theme::icons;
use rune::{El, Icon, TextEdit, TextStyle, col, el, icon, row as hbox, text};
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
const AVATAR: f32 = 32.0;

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

static TEXT_ALIGN_LEFT: Icon = Icon {
    name: "antimatter-text-align-left",
    view: 16.0,
    body: r#"<path d="M2.5 4H13.5M2.5 8H9.5M2.5 12H12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>"#,
};
static ARROW_ELBOW: Icon = Icon {
    name: "antimatter-arrow-elbow",
    view: 16.0,
    body: r#"<path d="M3 3V9C3 9.8 3.6 10.5 4.5 10.5H12M9 7.5L12.5 10.5L9 13.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

fn first_line(message: &str) -> String {
    message.lines().next().unwrap_or_default().trim().to_owned()
}

fn count_badge(key: String, count: u64, size: f32, k: &rune_kit::Kit) -> El {
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

fn thread_row(s: &State, thread: &ThreadPreview, k: &rune_kit::Kit) -> El {
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
        .child(lines)
        .child(count_badge(
            format!("thread-badge-{}", thread.id),
            thread.unread_replies.max(thread.unread_mentions),
            18.0,
            k,
        ));
    k.interactive(row)
        .on_press_tx(move |s: &mut State, tx| s.open_thread(&id, tx))
}

fn threads_section(s: &State, k: &rune_kit::Kit) -> Option<El> {
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
    let avatar = match s.avatars.user(&post.user_id) {
        Some(image) => el()
            .size(AVATAR, AVATAR)
            .radius(AVATAR / 2.0)
            .border(1.5, c.bg_base)
            .pixels(image.pixels()),
        None => el()
            .size(AVATAR, AVATAR)
            .radius(AVATAR / 2.0)
            .border(1.5, c.bg_base)
            .fill(c.layer_02),
    };
    el().size(AVATAR, AVATAR).child(avatar).child(
        el().key("status-dot")
            .size(6.0, 6.0)
            .radius(3.0)
            .fill(dot)
            .absolute(AVATAR - 6.0, AVATAR - 6.0)
            .a11y_hidden(),
    )
}

fn emoji_glyph(name: &str) -> String {
    emojis::get_by_shortcode(name).map_or_else(|| format!(":{name}:"), |e| e.as_str().to_owned())
}

fn emoji_face(s: &State, name: &str, size: f32, k: &rune_kit::Kit) -> El {
    match s.avatars.get(&format!("emoji:{name}")) {
        Some(image) => el().size(size, size).pixels(image.pixels()),
        None => text(emoji_glyph(name))
            .font(TextStyle {
                size: size * 0.8,
                ..k.ty.body
            })
            .a11y_hidden(),
    }
}

const EMOJI_TABS: [emojis::Group; 9] = [
    emojis::Group::SmileysAndEmotion,
    emojis::Group::PeopleAndBody,
    emojis::Group::AnimalsAndNature,
    emojis::Group::FoodAndDrink,
    emojis::Group::TravelAndPlaces,
    emojis::Group::Activities,
    emojis::Group::Objects,
    emojis::Group::Symbols,
    emojis::Group::Flags,
];

fn emoji_picker(s: &State, post: &Post, k: &rune_kit::Kit, layer: &mut Vec<El>) -> El {
    let c = &k.c;
    let query = s.emoji_query.text.trim().to_lowercase();
    let pick = |post_id: &str, name: String| {
        let post_id = post_id.to_owned();
        move |s: &mut State| s.toggle_reaction(post_id.clone(), name.clone())
    };
    let cell = |key: String, label: String, face: El, name: String| {
        rune::row()
            .key(key)
            .role("button")
            .label(label)
            .size(28.0, 28.0)
            .center()
            .radius(6.0)
            .hover(c.hover)
            .focusable(true)
            .cursor(rune::Cursor::Pointer)
            .on_press(pick(&post.id, name))
            .child(face)
    };
    let mut grid = rune::row().gap(2.0).flex_wrap();
    if !query.is_empty() {
        for e in emojis::iter()
            .filter(|e| e.name().contains(&query) || e.shortcodes().any(|c| c.contains(&query)))
        {
            let Some(name) = e.shortcode() else { continue };
            grid = grid.child(cell(
                format!("emoji-{name}"),
                e.name().to_owned(),
                text(e.as_str()).font(k.ty.body).a11y_hidden(),
                name.to_owned(),
            ));
        }
        for name in s.custom_emoji.iter().filter(|n| n.contains(&query)) {
            grid = grid.child(cell(
                format!("emoji-custom-{name}"),
                name.clone(),
                emoji_face(s, name, 20.0, k),
                name.clone(),
            ));
        }
    } else if let Some(group) = s.emoji_tab {
        for e in group
            .emojis()
            .filter(|e| e.skin_tone().is_none_or(|t| t == emojis::SkinTone::Default))
        {
            let Some(name) = e.shortcode() else { continue };
            grid = grid.child(cell(
                format!("emoji-{name}"),
                e.name().to_owned(),
                text(e.as_str()).font(k.ty.body).a11y_hidden(),
                name.to_owned(),
            ));
        }
    } else {
        for name in &s.custom_emoji {
            grid = grid.child(cell(
                format!("emoji-custom-{name}"),
                name.clone(),
                emoji_face(s, name, 20.0, k),
                name.clone(),
            ));
        }
    }
    let tab = |key: String, label: &str, face: El, on: bool, group: Option<emojis::Group>| {
        rune::row()
            .key(key)
            .role("button")
            .label(label.to_owned())
            .size(26.0, 26.0)
            .center()
            .radius(6.0)
            .fill(if on { c.layer_03 } else { c.layer_02 })
            .focusable(true)
            .cursor(rune::Cursor::Pointer)
            .on_press(move |s: &mut State| s.emoji_tab = group)
            .child(face)
    };
    let mut tabs = rune::row().gap(2.0);
    for group in EMOJI_TABS {
        let glyph = group.emojis().next().map_or("", |e| e.as_str());
        tabs = tabs.child(tab(
            format!("emoji-tab-{group:?}"),
            &format!("{group:?}"),
            text(glyph).font(k.ty.body).a11y_hidden(),
            s.emoji_tab == Some(group),
            Some(group),
        ));
    }
    if !s.custom_emoji.is_empty() {
        tabs = tabs.child(tab(
            "emoji-tab-custom".into(),
            "Custom",
            icon(&icons::STAR, 16.0).color(c.icon_muted).a11y_hidden(),
            s.emoji_tab.is_none(),
            None,
        ));
    }
    let open = s.emoji_picker.as_deref() == Some(post.id.as_str());
    let id = post.id.clone();
    rune_kit::Popover::new(format!("emoji-picker-{}", post.id))
        .trigger(
            IconButton::new(&icons::SMILEY)
                .label("Add reaction")
                .control_size(ControlSize::Small)
                .variant(IconButtonVariant::Ghost)
                .on_press(move |s: &mut State| {
                    s.emoji_query = TextEdit::default();
                    s.emoji_picker = Some(id.clone());
                })
                .build(k)
                .key("post-react"),
        )
        .open(open)
        .padding(8.0)
        .on_close(|s: &mut State| s.emoji_picker = None)
        .child(
            col()
                .w(284.0)
                .gap(8.0)
                .child(
                    rune::row()
                        .w_full()
                        .h(28.0)
                        .px(8.0)
                        .radius(6.0)
                        .fill(c.layer_02)
                        .center_y()
                        .child(
                            rune::text_input(&s.emoji_query, k.ty.small)
                                .key("emoji-search")
                                .label("Search emoji")
                                .single_line()
                                .grow(1.0)
                                .min_w(0.0)
                                .color(c.text_base)
                                .placeholder("Search emoji", c.text_muted)
                                .caret(c.text_base, k.selection())
                                .on_edit(|s: &mut State| &mut s.emoji_query),
                        ),
                )
                .child(tabs)
                .child(
                    col()
                        .key("emoji-grid")
                        .h(220.0)
                        .scroll(rune::ScrollSpec {
                            stick_bottom: false,
                        })
                        .child(grid),
                ),
        )
        .build(k, layer)
}

fn reaction_pills(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
    let c = &k.c;
    let me = s.authenticated.as_ref().map(|key| key.user_id());
    let mut groups: Vec<(&str, usize, bool, Vec<String>)> = Vec::new();
    for r in &post.metadata.reactions {
        let mine = me == Some(r.user_id.as_str());
        let who = if mine {
            "You".to_owned()
        } else {
            s.names.get(&r.user_id).unwrap_or(&r.user_id).clone()
        };
        match groups.iter_mut().find(|g| g.0 == r.emoji_name) {
            Some(g) => {
                g.1 += 1;
                g.2 |= mine;
                g.3.push(who);
            }
            None => groups.push((&r.emoji_name, 1, mine, vec![who])),
        }
    }
    if groups.is_empty() {
        return None;
    }
    let mut pills = rune::row().gap(4.0).flex_wrap();
    for (name, count, mine, who) in groups {
        pills = pills.child(
            rune::row()
                .key(format!("reaction-{}-{name}", post.id))
                .role("button")
                .label(format!("{name} {count}"))
                .help(format!("{} reacted with :{name}:", who.join(", ")))
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press({
                    let (id, name) = (post.id.clone(), name.to_owned());
                    move |s: &mut State| s.toggle_reaction(id.clone(), name.clone())
                })
                .h(24.0)
                .px(8.0)
                .gap(4.0)
                .center_y()
                .radius(12.0)
                .fill(c.layer_02)
                .border(1.0, if mine { c.bg_accent } else { c.border_base })
                .child(emoji_face(s, name, 16.0, k))
                .child(
                    text(count.to_string())
                        .font(TextStyle {
                            size: f32::from(s.message_font_size),
                            line_height: f32::from(s.message_font_size) * 1.6,
                            ..k.ty.ui
                        })
                        .color(c.text_muted)
                        .a11y_hidden(),
                ),
        );
    }
    Some(pills)
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

fn code_frame(k: &rune_kit::Kit, card: El, code: &rune_kit::CodeFrame<'_>) -> El {
    let source = code.source.to_owned();
    col()
        .key(format!("code-{}", code.index))
        .w_full()
        .radius(10.0)
        .fill(k.c.layer_02)
        .border(1.0, k.c.border_base)
        .clip_rounded(10.0)
        .child(
            rune::row()
                .w_full()
                .h(32.0)
                .pl(12.0)
                .pr(4.0)
                .center_y()
                .child(
                    text(code.language.unwrap_or("code").to_owned())
                        .font(k.ty.small_medium)
                        .color(k.c.text_muted)
                        .grow(1.0),
                )
                .child(
                    IconButton::new(&icons::COPY)
                        .label("Copy code")
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press_tx(move |_: &mut State, tx| tx.copy(source.clone()))
                        .build(k)
                        .key(format!("code-copy-{}", code.index)),
                ),
        )
        .child(card)
}

fn image_attachments(s: &State, post: &Post, layer: &mut Vec<El>, k: &rune_kit::Kit) -> Option<El> {
    let images: Vec<_> = post
        .metadata
        .files
        .iter()
        .filter(|f| f.is_image())
        .collect();
    let chip = |key: String, label: String, name: String| {
        rune::row()
            .key(key)
            .role("button")
            .label(label)
            .h(24.0)
            .px(8.0)
            .gap(6.0)
            .center_y()
            .radius(6.0)
            .fill(k.c.layer_02)
            .border(1.0, k.c.border_base)
            .focusable(true)
            .cursor(rune::Cursor::Pointer)
            .child(
                icon(&icons::IMAGE, 14.0)
                    .color(k.c.icon_muted)
                    .a11y_hidden(),
            )
            .child(
                text(name)
                    .font(k.ty.small)
                    .color(k.c.text_accent)
                    .truncate()
                    .a11y_hidden(),
            )
    };
    match images.as_slice() {
        [] => return None,
        [file] => {
            let target = (*file).clone();
            Some(
                rune::row().child(
                    chip(
                        format!("image-{}", file.id),
                        format!("Open {}", file.name),
                        file.name.clone(),
                    )
                    .on_press(move |s: &mut State| s.open_file(target.clone())),
                ),
            )
        }
        many => {
            let id = post.id.clone();
            let open = s.image_menu.as_deref() == Some(post.id.as_str());
            let layers = many.len().min(3) - 1;
            let trigger = chip(
                format!("images-{}", post.id),
                format!("{} images", many.len()),
                format!("{} images", many.len()),
            )
            .on_press({
                let id = id.clone();
                move |s: &mut State| s.image_menu = Some(id.clone())
            });
            let mut stack = rune::row().key(format!("image-stack-{}", post.id));
            for i in (1..=layers).rev() {
                stack = stack.child(
                    el().w(0.0).h(24.0).child(
                        el().size(40.0, 24.0)
                            .absolute(i as f32 * 3.0, 0.0)
                            .radius(6.0)
                            .fill(k.c.layer_03)
                            .border(1.0, k.c.border_base)
                            .a11y_hidden(),
                    ),
                );
            }
            let mut menu = rune_kit::Menu::new(format!("images-menu-{}", post.id))
                .trigger(stack.child(trigger))
                .open(open)
                .on_close(|s: &mut State| s.image_menu = None);
            for file in many {
                let target = (*file).clone();
                menu = menu.item(MenuItem::new(file.name.clone()).on_select(
                    move |s: &mut State| {
                        s.image_menu = None;
                        s.open_file(target.clone());
                    },
                ));
            }
            Some(rune::row().child(menu.build(k, layer)))
        }
    }
}

fn reply_quote(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
    const HEIGHT: f32 = 24.0;
    const SMALL: f32 = 20.0;
    let parent = s
        .posts
        .iter()
        .find(|p| !post.root_id.is_empty() && p.id == post.root_id)?;
    let c = &k.c;
    let pad = post_padding(s.message_spacing);
    let name = s.names.get(&parent.user_id).unwrap_or(&parent.user_id);
    let snippet = match parent.message.lines().find(|l| !l.trim().is_empty()) {
        Some(line) => line.to_owned(),
        None => parent
            .metadata
            .files
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
    };
    let elbow_x = 16.0
        + if s.show_timeline_avatars {
            AVATAR / 2.0
        } else {
            3.0
        };
    let avatar = match s.avatars.user(&parent.user_id) {
        Some(image) => el()
            .size(SMALL, SMALL)
            .radius(SMALL / 2.0)
            .pixels(image.pixels()),
        None => el().size(SMALL, SMALL).radius(SMALL / 2.0).fill(c.layer_02),
    };
    let start = elbow_x + 8.0;
    Some(
        el().key(format!("reply-{}", post.id))
            .w_full()
            .h(HEIGHT + pad)
            .child(
                el().size(1.5, HEIGHT / 2.0 + pad)
                    .fill(c.border_base)
                    .absolute(elbow_x, HEIGHT / 2.0)
                    .a11y_hidden(),
            )
            .child(
                el().size(start - elbow_x - 2.0, 1.5)
                    .fill(c.border_base)
                    .absolute(elbow_x, HEIGHT / 2.0)
                    .a11y_hidden(),
            )
            .child(
                rune::row()
                    .gap(6.0)
                    .h(HEIGHT)
                    .center_y()
                    .absolute(start, 0.0)
                    .child(avatar)
                    .child(
                        text(name.clone())
                            .font(k.ty.small_medium)
                            .color(c.text_faint)
                            .selectable(true),
                    )
                    .child(
                        text(snippet)
                            .font(k.ty.small)
                            .color(c.text_faint)
                            .selectable(true)
                            .truncate()
                            .shrink(),
                    ),
            ),
    )
}

fn link_preview(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
    let url = antimatter_services::preview::first_url(&post.message)?;
    let key = url.to_string();
    let Some(Some(preview)) = s.previews.get(&key) else {
        let fetch = move |s: &mut State, _| s.fetch_preview(url.clone());
        return Some(
            el().key(format!("preview-probe-{}", post.id))
                .h(0.0)
                .on_layout(fetch),
        );
    };
    let c = &k.c;
    let target = key.clone();
    let mut body = col()
        .grow(1.0)
        .shrink()
        .min_w(0.0)
        .gap(2.0)
        .child(
            text(preview.site.clone())
                .font(k.ty.small)
                .color(c.text_muted)
                .truncate(),
        )
        .child(
            text(preview.title.clone())
                .font(k.ty.small_medium)
                .color(c.text_accent)
                .truncate(),
        );
    if !preview.description.is_empty() {
        body = body.child(
            text(preview.description.clone())
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap()
                .max_lines(2),
        );
    }
    let mut card = rune::row()
        .key(format!("preview-{}", post.id))
        .role("link")
        .label(format!("Open {}", preview.title))
        .w(420.0)
        .padding(10.0)
        .gap(10.0)
        .radius(8.0)
        .fill(c.layer_02)
        .border(1.0, c.border_base)
        .focusable(true)
        .cursor(rune::Cursor::Pointer)
        .on_press(move |_: &mut State| {
            let _ = std::process::Command::new("open").arg(&target).status();
        })
        .child(body);
    if let Some(image) = s.avatars.get(&format!("preview:{key}")) {
        card = card.child(el().size(64.0, 64.0).radius(6.0).pixels(image.pixels()));
    }
    Some(card)
}

fn file_attachments(post: &Post, k: &rune_kit::Kit) -> Option<El> {
    if post.metadata.files.iter().all(|f| f.is_image()) {
        return None;
    }
    let mut list = col().gap(4.0);
    for file in post.metadata.files.iter().filter(|f| !f.is_image()) {
        let target = file.clone();
        let kind = if file.extension.is_empty() {
            file.mime_type.clone()
        } else {
            file.extension.to_uppercase()
        };
        list = list.child(
            rune::row()
                .key(format!("file-{}", file.id))
                .role("button")
                .label(format!("Download {}", file.name))
                .w(320.0)
                .padding(8.0)
                .gap(10.0)
                .center_y()
                .radius(8.0)
                .fill(k.c.layer_02)
                .border(1.0, k.c.border_base)
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press(move |s: &mut State| s.download_file(target.clone()))
                .child(icon(&icons::FILE, 24.0).color(k.c.icon_muted).a11y_hidden())
                .child(
                    col()
                        .grow(1.0)
                        .child(
                            text(file.name.clone())
                                .font(k.ty.small_medium)
                                .color(k.c.text_base)
                                .truncate()
                                .a11y_hidden(),
                        )
                        .child(
                            text(format!("{kind} · {}", file_size(file.size)))
                                .font(k.ty.small)
                                .color(k.c.text_muted)
                                .a11y_hidden(),
                        ),
                )
                .child(
                    icon(&icons::DOWNLOAD, 18.0)
                        .color(k.c.icon_muted)
                        .a11y_hidden(),
                ),
        );
    }
    Some(list)
}

fn file_size(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 20 => format!("{:.1} MB", b as f64 / f64::from(1 << 20)),
        b if b >= 1 << 10 => format!("{:.1} KB", b as f64 / f64::from(1 << 10)),
        b => format!("{b} B"),
    }
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

fn user_avatar(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let me = s.authenticated.as_ref();
    let dot = match s.presence.as_str() {
        "online" => c.success.icon,
        "away" | "dnd" => c.warning.icon,
        _ => c.icon_muted,
    };
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
        menu = menu.item(
            MenuItem::new(name.clone())
                .checked(*name == current)
                .on_select(move |s: &mut State| {
                    s.server_open = false;
                    if let Some(account) = s.accounts.get(i) {
                        let key = account.key.clone();
                        s.switch_account(key);
                    }
                }),
        );
    }
    menu.build(k, layer)
}

fn new_row(key: &str, label: &str, kind: NewKind, k: &rune_kit::Kit) -> El {
    let row = hbox()
        .key(key)
        .role("button")
        .label(label)
        .w_full()
        .h(28.0)
        .pl(8.0 + 16.0)
        .pr(8.0)
        .gap(6.0)
        .center_y()
        .radius(k.radius.md)
        .focusable(true)
        .child(icon(&icons::PLUS, 16.0).color(k.c.icon_muted).a11y_hidden())
        .child(
            text(label)
                .font(k.ty.small)
                .color(k.c.text_muted)
                .truncate()
                .grow(1.0),
        );
    k.interactive(row)
        .on_press(move |s: &mut State| s.open_new(kind))
}

fn new_dialog(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
    if let Some(kind) = s.new_dialog {
        let (title, hint, action) = match kind {
            NewKind::Channel => ("Create channel", "Channel name", "Create"),
            NewKind::Dm => ("Start direct message", "Username", "Start"),
        };
        let mut body = col().w_full().gap(8.0).px(16.0).pb(16.0).child(
            rune_kit::TextInput::new(&s.new_name)
                .label(hint)
                .placeholder(hint)
                .width(None)
                .height(32.0)
                .on_edit(|s: &mut State| &mut s.new_name)
                .on_submit(|s: &mut State, _| s.submit_new())
                .build(k)
                .key("new-name"),
        );
        if let Some(error) = &s.new_error {
            body = body.child(text(error.clone()).font(k.ty.small).color(k.c.danger.fg));
        }
        body = body.child(hbox().w_full().justify_end().child(button_as(
            rune_kit::ButtonVariant::Submit,
            "new-submit",
            action,
            s.new_busy || s.new_name.text.trim().is_empty(),
            |s| s.submit_new(),
        )));
        rune_kit::Dialog::new("new-dialog", title)
            .open(true)
            .width(360.0)
            .fit()
            .on_close(|s: &mut State| s.close_new())
            .child(body)
            .build(k, layer);
    }
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

fn attach_button(
    k: &rune_kit::Kit,
    key: &str,
    label: &str,
    glyph: &'static Icon,
    images: bool,
    locked: bool,
) -> El {
    let b = IconButton::new(glyph)
        .label(label)
        .control_size(ControlSize::Small)
        .variant(IconButtonVariant::Ghost)
        .disabled(locked)
        .on_press_tx(move |_: &mut State, tx| {
            let mut options = rune::FileDialogOptions {
                title: "Attach".into(),
                ..Default::default()
            };
            if images {
                options = options.filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "heic"]);
            }
            tx.open_file(options, |s: &mut State, result, _| {
                if let Ok(Some(path)) = result {
                    s.attach(&[path]);
                }
            });
        })
        .build(k)
        .key(key);
    if locked { b.inert() } else { b }
}

fn reply_chip(s: &State, k: &rune_kit::Kit) -> Option<El> {
    let post = s.reply_to.as_ref()?;
    let name = s.names.get(&post.user_id).unwrap_or(&post.user_id);
    let snippet = match post.message.lines().find(|l| !l.trim().is_empty()) {
        Some(line) => line.to_owned(),
        None => post
            .metadata
            .files
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
    };
    Some(
        rune::row()
            .key("reply-chip")
            .w_full()
            .gap(6.0)
            .center_y()
            .child(
                icon(&icons::ARROW_BEND_UP_LEFT, 12.0)
                    .color(k.c.icon_muted)
                    .a11y_hidden(),
            )
            .child(
                text(format!("Replying to {name}"))
                    .font(k.ty.small_medium)
                    .color(k.c.text_muted),
            )
            .child(
                text(snippet)
                    .font(k.ty.small)
                    .color(k.c.text_faint)
                    .truncate()
                    .shrink(),
            )
            .child(
                IconButton::new(&icons::X)
                    .label("Cancel reply")
                    .control_size(ControlSize::Small)
                    .variant(IconButtonVariant::Ghost)
                    .on_press(|s: &mut State| s.reply_to = None)
                    .build(k)
                    .key("reply-cancel"),
            ),
    )
}

fn attachment_pills(s: &State, k: &rune_kit::Kit) -> Option<El> {
    if s.attachments.is_empty() {
        return None;
    }
    let mut pills = rune::row().key("attachments").w_full().gap(6.0).flex_wrap();
    for (i, path) in s.attachments.iter().enumerate() {
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        pills = pills.child(
            rune::row()
                .key(format!("attachment-{i}"))
                .h(26.0)
                .pl(10.0)
                .pr(2.0)
                .gap(4.0)
                .center_y()
                .radius(13.0)
                .fill(k.c.layer_02)
                .border(1.0, k.c.border_base)
                .child(
                    text(name.clone())
                        .font(k.ty.small)
                        .color(k.c.text_base)
                        .truncate()
                        .a11y_hidden(),
                )
                .child(
                    IconButton::new(&icons::X)
                        .label(format!("Remove {name}"))
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press(move |s: &mut State| {
                            if i < s.attachments.len() {
                                s.attachments.remove(i);
                            }
                        })
                        .build(k)
                        .key(format!("attachment-remove-{i}")),
                ),
        );
    }
    Some(pills)
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
    sidebar = sidebar.child(section(
        "channels",
        "Channels",
        regular.len(),
        s.channels_collapsed,
        |s: &mut State, _| s.channels_collapsed = !s.channels_collapsed,
        regular
            .into_iter()
            .map(|channel| channel_row(s, channel, locked, &k))
            .chain([new_row("create-channel", "Create channel…", NewKind::Channel, &k)])
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
            .chain([new_row("start-dm", "Start direct message…", NewKind::Dm, &k)])
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
                        .caret(
                            if s.caret_on {
                                c.text_base
                            } else {
                                rune::Color::TRANSPARENT
                            },
                            k.selection(),
                        )
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
    let mut previous_day = None;
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
    for post in s.search_results.as_ref().unwrap_or(&s.posts) {
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
        let line = (f32::from(s.message_font_size) * 1.6).max(if s.show_timeline_avatars {
            AVATAR
        } else {
            0.0
        });
        let target = post.channel_id.clone();
        let mut row = rune::row().key(format!("post-{}", post.id));
        if s.focus_post.as_deref() == Some(post.id.as_str()) {
            let key = format!("post-{}", post.id);
            row = row.on_layout_tx(move |s: &mut State, _, tx| {
                if s.focus_post.take().is_some() {
                    tx.scroll_into_view(key.clone());
                }
            });
        }
        if searching {
            row = row
                .role("button")
                .label(format!("Open {}", post.message))
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press(move |s: &mut State| {
                    s.search_results = None;
                    s.load(target.clone());
                });
        }
        ledger = ledger.children(reply_quote(s, post, &k)).child(
            row.w_full()
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
                        .pt((line - f32::from(s.message_font_size) * 1.6) / 2.0)
                        .child(
                            Markdown::new(&post.message)
                                .selectable(true)
                                .highlights(
                                    mentions(&post.message, s.my_username())
                                        .into_iter()
                                        .map(|(range, me)| {
                                            let bg = if me { c.bg_accent } else { c.warning.icon };
                                            (range, Highlight::new().bg(bg).fg(c.bg_base))
                                        })
                                        .collect::<Vec<_>>(),
                                )
                                .style(
                                    MarkdownStyle::from_kit(&k)
                                        .code_block(c.layer_03, c.border_base)
                                        .body_font(TextStyle {
                                            size: f32::from(s.message_font_size),
                                            line_height: f32::from(s.message_font_size) * 1.6,
                                            ..k.ty.ui
                                        }),
                                )
                                .code_frame({
                                    let k = k.clone();
                                    move |card, code| code_frame(&k, card, code)
                                })
                                .build(&k),
                        )
                        .children(image_attachments(s, post, &mut layer, &k))
                        .children(file_attachments(post, &k))
                        .children(link_preview(s, post, &k))
                        .children(reaction_pills(s, post, &k)),
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
                                .on_press_tx({
                                    let post = post.clone();
                                    move |s: &mut State, tx| {
                                        s.quote_reply(&post);
                                        tx.focus("draft", false);
                                    }
                                })
                                .build(&k)
                                .key("post-reply"),
                        )
                        .child(emoji_picker(s, post, &k, &mut layer)),
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
    if !searching {
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
    }
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
    main = main.child(ledger.scroll_bar(&k));
    if !searching {
        main = main
            .on_drop_files(|s: &mut State, files, _| s.attach(files))
            .child(
                col()
                    .w_full()
                    .px(16.0)
                    .py(8.0)
                    .gap(8.0)
                    .fill(c.layer_01)
                    .children(reply_chip(s, &k))
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
                                locked,
                            ))
                            .child(attach_button(
                                &k,
                                "attach-file",
                                "Attach file",
                                &icons::PAPERCLIP,
                                false,
                                locked,
                            ))
                            .child(button_as(
                                ButtonVariant::Contrast,
                                "send",
                                "Send",
                                locked
                                    || s.channel.is_none()
                                    || (s.markdown().trim().is_empty() && s.attachments.is_empty()),
                                |s| s.send(),
                            )),
                    ),
            );
    }
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
