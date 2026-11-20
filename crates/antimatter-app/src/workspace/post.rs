use super::*;

pub(super) const LEDGER_TOP_SLACK: f32 = 24.0;

pub(crate) fn post_padding(spacing: MessageSpacing) -> f32 {
    match spacing {
        MessageSpacing::Small => 4.0,
        MessageSpacing::Medium => 8.0,
        MessageSpacing::Large => 12.0,
    }
}

pub(super) fn older_loader(s: &State, k: &rune_kit::Kit) -> El {
    if !s.loading_older {
        return el().h(0.0);
    }
    rune::icon(&antimatter_theme::loader::SPINNER, 16.0)
        .color(k.c.icon_muted)
        .looping(rune::LoopSpec::rotation(0.9))
        .label("Loading older messages")
        .role("progressbar")
}

pub(super) fn post_day(create_at: i64) -> Option<chrono::NaiveDate> {
    chrono::DateTime::from_timestamp_millis(create_at)
        .map(|at| at.with_timezone(&chrono::Local).date_naive())
}

pub(super) fn post_time(create_at: i64) -> String {
    chrono::DateTime::from_timestamp_millis(create_at)
        .map(|at| {
            at.with_timezone(&chrono::Local)
                .format("%-I:%M %P")
                .to_string()
        })
        .unwrap_or_default()
}

pub(super) const AUTHOR_RUN_MS: i64 = 5 * 60 * 1000;

pub(super) fn continues_author_run(previous: Option<&Post>, post: &Post) -> bool {
    previous.is_some_and(|prev| {
        prev.user_id == post.user_id
            && post.create_at - prev.create_at <= AUTHOR_RUN_MS
            && post_day(prev.create_at) == post_day(post.create_at)
    })
}

pub(super) fn presence_dot(status: Option<&str>, c: &rune_kit::Palette) -> rune::Color {
    match status {
        Some("online") => rune::color::hex("#46a758").expect("valid presence color"),
        Some("away") | Some("dnd") => c.warning.icon,
        _ => c.icon_muted,
    }
}

pub(super) fn author_marker(s: &State, post: &Post, c: &rune_kit::Palette) -> El {
    let avatar_size = f32::from(s.avatar_size);
    let dot = presence_dot(s.peer_presence.get(&post.user_id).map(String::as_str), c);
    if !s.show_timeline_avatars {
        return el().size(6.0, 6.0).radius(3.0).fill(dot);
    }
    let avatar = match s.avatars.user(&post.user_id) {
        Some(image) => el()
            .size(avatar_size, avatar_size)
            .radius(avatar_size / 2.0)
            .border(1.5, c.bg_base)
            .pixels(image.pixels()),
        None => el()
            .size(avatar_size, avatar_size)
            .radius(avatar_size / 2.0)
            .border(1.5, c.bg_base)
            .fill(c.layer_02),
    };
    el().size(avatar_size, avatar_size).child(avatar).child(
        el().key("status-dot")
            .size(6.0, 6.0)
            .radius(3.0)
            .fill(dot)
            .absolute(avatar_size - 6.0, avatar_size - 6.0)
            .a11y_hidden(),
    )
}

pub(super) fn mentions(message: &str, me: Option<&str>) -> Vec<(std::ops::Range<usize>, bool)> {
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

pub(super) fn code_frame(k: &rune_kit::Kit, card: El, code: &rune_kit::CodeFrame<'_>) -> El {
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

pub(super) fn post_row(s: &State, i: usize) -> El {
    let posts = s.search_results.as_ref().unwrap_or(&s.posts);
    post_row_in(s, posts, i, false)
}

pub(super) fn thread_post_row(s: &State, i: usize) -> El {
    let posts = s.thread.as_ref().map_or(&[][..], |t| t.posts.as_slice());
    post_row_in(s, posts, i, true)
}

pub(super) fn post_row_in(s: &State, posts: &[Post], i: usize, in_thread: bool) -> El {
    let k = workspace_theme();
    let c = &k.c;
    let post = &posts[i];
    let searching = !in_thread && s.search_results.is_some();
    let previous = i.checked_sub(1).map(|p| &posts[p]);
    let previous_day = previous.and_then(|p| post_day(p.create_at));
    let day = post_day(post.create_at);
    let continued = !searching && post.root_id.is_empty() && continues_author_run(previous, post);
    let line = (f32::from(s.message_font_size) * 1.6).max(if s.show_timeline_avatars {
        f32::from(s.avatar_size)
    } else {
        0.0
    });
    let target = post.channel_id.clone();
    let post_id = post.id.clone();
    let mut row = rune::row();
    if searching {
        row = row
            .role("button")
            .label(format!("Open {}", post.message))
            .focusable(true)
            .cursor(rune::Cursor::Pointer)
            .on_press(move |s: &mut State| {
                s.search_results = None;
                s.focus_post = Some((target.clone(), post_id.clone()));
                s.load(target.clone());
            });
    }
    let mut block = col();
    if day != previous_day
        && let Some(day) = day
    {
        block = block.child(
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
    block
        .children((!in_thread).then(|| reply_quote(s, post, &k)).flatten())
        .child(
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
                        .children((!continued).then(|| author_marker(s, post, c)))
                        .children((!continued).then(|| {
                            text(s.names.get(&post.user_id).unwrap_or(&post.user_id))
                                .shrink()
                                .font(k.ty.small)
                                .color(crate::name_colors::color_for(&s.name_colors, &post.user_id))
                                .truncate()
                        })),
                )
                .child(
                    rune::row().h(line).center_y().shrink().child(
                        text(post_time(post.create_at))
                            .font(k.ty.small)
                            .color(if continued {
                                rune::Color::TRANSPARENT
                            } else {
                                c.text_muted
                            })
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
                                .image_frame(|el, frame| {
                                    let [w, h] = frame
                                        .image
                                        .size()
                                        .unwrap_or([GIF_MAX_W as u32, GIF_MAX_H as u32]);
                                    let ratio = w as f32 / (h.max(1) as f32);
                                    el.max_w(GIF_MAX_W).max_h(GIF_MAX_H).aspect_fit(ratio)
                                })
                                .images({
                                    let pictures: std::collections::HashMap<String, rune::Image> =
                                        gif_sources(&post.message)
                                            .into_iter()
                                            .filter_map(|url| {
                                                let image = s.gifs.get(url.as_str())?.clone();
                                                Some((url.to_string(), image))
                                            })
                                            .collect();
                                    move |src: &str| pictures.get(src).cloned()
                                })
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
                                        .code_block_font(TextStyle {
                                            family: rune::Family::SystemMono,
                                            ..k.ty.mono
                                        })
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
                        .children(image_attachments(post, s, &k))
                        .children(file_attachments(post, &k))
                        .children(link_preview(s, post, &k))
                        .children(reaction_pills(s, post, &k))
                        .children(poll_card(s, post, &k)),
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
                                        if in_thread {
                                            tx.focus("thread-draft", false);
                                        } else {
                                            s.quote_reply(&post);
                                            tx.focus("draft", false);
                                        }
                                    }
                                })
                                .build(&k)
                                .key("post-reply"),
                        )
                        .children((!in_thread).then(|| {
                            IconButton::new(&icons::THREAD)
                                .label("Open thread")
                                .control_size(ControlSize::Small)
                                .variant(IconButtonVariant::Ghost)
                                .on_press_tx({
                                    let post = post.clone();
                                    move |s: &mut State, tx| {
                                        s.open_thread_pane(&post);
                                        tx.focus("thread-draft", false);
                                    }
                                })
                                .build(&k)
                                .key("post-thread")
                        }))
                        .children(
                            (!in_thread
                                && s.authenticated.as_ref().map(|key| key.user_id())
                                    == Some(post.user_id.as_str()))
                            .then(|| {
                                IconButton::new(&icons::PENCIL_SIMPLE)
                                    .label("Edit")
                                    .control_size(ControlSize::Small)
                                    .variant(IconButtonVariant::Ghost)
                                    .on_press_tx({
                                        let post = post.clone();
                                        move |s: &mut State, tx| {
                                            s.begin_edit(&post);
                                            tx.focus("draft", false);
                                        }
                                    })
                                    .build(&k)
                                    .key("post-edit")
                            }),
                        )
                        .children(
                            (s.authenticated.as_ref().map(|key| key.user_id())
                                == Some(post.user_id.as_str()))
                            .then(|| {
                                IconButton::new(&icons::TRASH)
                                    .label("Delete")
                                    .control_size(ControlSize::Small)
                                    .variant(IconButtonVariant::Ghost)
                                    .on_press({
                                        let post = post.clone();
                                        move |s: &mut State| s.open_delete(&post)
                                    })
                                    .build(&k)
                                    .key("post-delete")
                            }),
                        )
                        .children((!in_thread).then(|| emoji_picker_trigger(s, post, &k))),
                ),
        )
}

pub(super) fn reply_quote(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
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
            f32::from(s.avatar_size) / 2.0
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

#[cfg(test)]
mod mention_tests {
    use super::mentions;

    #[test]
    fn finds_here_and_me_only_at_word_starts() {
        let m = "@here hi @Ada, not a@ada or @bob";
        assert_eq!(mentions(m, Some("ada")), vec![(0..5, false), (9..13, true)]);
    }
}

#[cfg(test)]
mod presence_tests {
    use super::presence_dot;

    #[test]
    fn online_is_green_and_away_is_not() {
        let kit = crate::theme::workspace_theme();
        let green = rune::color::hex("#46a758").unwrap();
        assert_eq!(presence_dot(Some("online"), &kit.c), green);
        assert_ne!(presence_dot(Some("away"), &kit.c), green);
        assert_eq!(presence_dot(None, &kit.c), kit.c.icon_muted);
    }
}
