use super::*;

pub(super) fn poll_card(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
    let c = &k.c;
    let poll = post.poll()?;
    let attachment = poll.attachment()?;
    let options: Vec<_> = attachment.actions.iter().filter(|a| a.is_vote()).collect();
    let has_counts = options.iter().any(|a| a.vote_count().is_some());
    let total: u64 = options.iter().filter_map(|a| a.vote_count()).sum();
    let voted = s.poll_votes.get(&post.id);
    let question = if attachment.title.is_empty() {
        attachment.text.as_str()
    } else {
        attachment.title.as_str()
    };
    let mut card = col()
        .key(format!("poll-{}", post.id))
        .w(300.0)
        .gap(8.0)
        .padding(12.0)
        .radius(12.0)
        .fill(c.layer_02)
        .border(1.0, c.border_base)
        .child(
            text(question)
                .font(TextStyle {
                    size: f32::from(s.message_font_size),
                    line_height: f32::from(s.message_font_size) * 1.6,
                    ..k.ty.ui
                })
                .color(c.text_base),
        );
    for option in options {
        let selected = voted == Some(&option.id);
        card = card.child(
            hbox()
                .key(format!("poll-option-{}-{}", post.id, option.id))
                .role("button")
                .label(format!("Vote for {}", option.option()))
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press({
                    let (post_id, action_id) = (post.id.clone(), option.id.clone());
                    move |s: &mut State| s.vote_poll(post_id.clone(), action_id.clone())
                })
                .h(32.0)
                .px(10.0)
                .gap(6.0)
                .center_y()
                .radius(8.0)
                .fill(if selected { c.bg_accent } else { c.layer_01 })
                .child(
                    text(option.option())
                        .font(TextStyle {
                            size: f32::from(s.message_font_size),
                            line_height: f32::from(s.message_font_size) * 1.6,
                            ..k.ty.ui
                        })
                        .color(c.text_base),
                )
                .child(el().grow(1.0))
                .children(has_counts.then(|| {
                    text(
                        option
                            .vote_count()
                            .map_or_else(String::new, |n| n.to_string()),
                    )
                    .font(TextStyle {
                        size: f32::from(s.message_font_size),
                        line_height: f32::from(s.message_font_size) * 1.6,
                        ..k.ty.ui
                    })
                    .color(c.text_muted)
                    .a11y_hidden()
                })),
        );
    }
    let summary = if has_counts {
        format!("{total} {}", if total == 1 { "vote" } else { "votes" })
    } else if voted.is_some() {
        "Your vote was recorded. Results are hidden until the poll ends.".to_owned()
    } else {
        "Results are hidden until the poll ends.".to_owned()
    };
    card = card.child(
        text(summary)
            .font(TextStyle {
                size: 12.0,
                line_height: 12.0 * 1.4,
                ..k.ty.ui
            })
            .color(c.text_muted),
    );
    if s.authenticated.as_ref().map(|key| key.user_id()) == Some(post.user_id.as_str()) {
        card = card.child(
            text("End poll")
                .key(format!("poll-end-{}", post.id))
                .role("button")
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press({
                    let post_id = post.id.clone();
                    move |s: &mut State| s.open_end_poll(post_id.clone())
                })
                .font(TextStyle {
                    size: 12.0,
                    line_height: 12.0 * 1.4,
                    ..k.ty.ui
                })
                .color(c.danger.fg),
        );
    }
    Some(card)
}

pub(super) fn create_poll_dialog(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
    if !s.creating_poll {
        return;
    }
    let mut body = col().gap(10.0).child(
        rune_kit::TextInput::new(&s.poll_question)
            .label("Question")
            .placeholder("Ask a question")
            .width(None)
            .height(28.0)
            .on_edit(|s: &mut State| &mut s.poll_question)
            .build(k)
            .key("poll-question"),
    );
    for (i, option) in s.poll_options.iter().enumerate() {
        body = body.child(
            rune_kit::TextInput::new(option)
                .label(format!("Option {}", i + 1))
                .placeholder(format!("Option {}", i + 1))
                .width(None)
                .height(28.0)
                .on_edit(move |s: &mut State| &mut s.poll_options[i])
                .build(k)
                .key(format!("poll-option-input-{i}")),
        );
    }
    if let Some(error) = &s.poll_error {
        body = body.child(text(error.clone()).font(k.ty.small).color(k.c.danger.fg));
    }
    body = body.child(
        hbox()
            .w_full()
            .justify_between()
            .child(button_as(
                rune_kit::ButtonVariant::Outline,
                "poll-add-option",
                "Add option",
                s.poll_options.len() >= 10 || s.poll_busy,
                |s| s.add_poll_option(),
            ))
            .child(button_as(
                rune_kit::ButtonVariant::Submit,
                "poll-create",
                "Create poll",
                s.poll_busy,
                |s| s.submit_create_poll(),
            )),
    );
    rune_kit::Dialog::new("create-poll-dialog", "Create a poll")
        .open(true)
        .width(360.0)
        .fit()
        .on_close(|s: &mut State| s.close_create_poll())
        .child(body)
        .build(k, layer);
}

pub(super) fn delete_post_dialog(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
    if s.deleting.is_none() {
        return;
    }
    let body = col()
        .gap(12.0)
        .child(
            text("This message will be permanently deleted for everyone.")
                .font(k.ty.small)
                .color(k.c.text_muted),
        )
        .child(
            hbox()
                .w_full()
                .justify_end()
                .gap(8.0)
                .child(button_as(
                    rune_kit::ButtonVariant::Outline,
                    "delete-post-cancel",
                    "Cancel",
                    false,
                    |s| s.close_delete(),
                ))
                .child(button_as(
                    rune_kit::ButtonVariant::Danger,
                    "delete-post-confirm",
                    "Delete",
                    false,
                    |s| s.confirm_delete(),
                )),
        );
    rune_kit::Dialog::new("delete-post-dialog", "Delete this message?")
        .open(true)
        .width(360.0)
        .fit()
        .on_close(|s: &mut State| s.close_delete())
        .child(body)
        .build(k, layer);
}

pub(super) fn end_poll_dialog(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
    if s.ending_poll.is_none() {
        return;
    }
    let body = col()
        .gap(12.0)
        .child(
            text("Voting will close and the final results will be posted.")
                .font(k.ty.small)
                .color(k.c.text_muted),
        )
        .child(
            hbox()
                .w_full()
                .justify_end()
                .gap(8.0)
                .child(button_as(
                    rune_kit::ButtonVariant::Outline,
                    "end-poll-cancel",
                    "Cancel",
                    false,
                    |s| s.close_end_poll(),
                ))
                .child(button_as(
                    rune_kit::ButtonVariant::Danger,
                    "end-poll-confirm",
                    "End poll",
                    false,
                    |s| s.end_poll(),
                )),
        );
    rune_kit::Dialog::new("end-poll-dialog", "End this poll?")
        .open(true)
        .width(360.0)
        .fit()
        .on_close(|s: &mut State| s.close_end_poll())
        .child(body)
        .build(k, layer);
}
