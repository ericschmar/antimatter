use super::*;

pub(super) fn new_row(key: &str, label: &str, kind: NewKind, k: &rune_kit::Kit) -> El {
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

pub(super) fn gif_picker(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
    if !s.gif_picker {
        return;
    }
    let c = &k.c;
    let mut grid = rune::row().gap(4.0).flex_wrap();
    for (i, gif) in s.gif_results.iter().flatten().enumerate() {
        let target = gif.clone();
        let thumb = match s.gifs.get(gif.preview.as_str()) {
            Some(image) => el().size(128.0, 96.0).radius(6.0).pixels(image.pixels()),
            None => el()
                .size(128.0, 96.0)
                .radius(6.0)
                .fill(c.layer_02)
                .a11y_hidden(),
        };
        grid = grid.child(
            rune::row()
                .key(format!("gif-{i}"))
                .role("button")
                .label(gif.title.clone())
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press(move |s: &mut State| s.insert_gif(&target))
                .child(thumb),
        );
    }
    let status = if s.gif_busy {
        "Loading GIFs…"
    } else if s.gif_results.as_ref().is_some_and(|r| r.is_empty()) {
        "No GIFs found"
    } else if s.giphy_key.is_none() {
        "GIF search is not configured"
    } else {
        ""
    };
    let body = col()
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
                    rune::text_input(&s.gif_query, k.ty.small)
                        .key("gif-query")
                        .label("Search GIFs")
                        .single_line()
                        .grow(1.0)
                        .min_w(0.0)
                        .color(c.text_base)
                        .placeholder("Search GIFs", c.text_muted)
                        .caret(s.caret(c.text_base), k.selection())
                        .on_edit(|s: &mut State| &mut s.gif_query)
                        .on_submit(|s: &mut State, _| {
                            let query = s.gif_query.text.trim().to_owned();
                            if query.is_empty() {
                                s.load_gifs(None);
                            } else {
                                s.load_gifs(Some(query));
                            }
                        }),
                ),
        )
        .child(
            col()
                .key("gif-grid")
                .h(220.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .child(grid),
        )
        .children((!status.is_empty()).then(|| text(status).font(k.ty.small).color(c.text_muted)));
    let surface = rune_kit::popover::raised(k, body.padding(8.0), k.radius.md);
    layer.push(rune_kit::scrim("gif-picker-scrim", |s: &mut State| {
        s.close_gif_picker()
    }));
    layer.push(rune_kit::popover::anchored(
        k,
        surface,
        "gif-picker-open",
        rune_kit::Placement::TopStart,
        4.0,
    ));
}

pub(super) fn mention_popover(s: &State, k: &rune_kit::Kit, layer: &mut Vec<El>) {
    let Some((start, users)) = s.mention_matches() else {
        return;
    };
    let c = &k.c;
    let mut rows = col().key("mention-list").w(240.0).gap(2.0);
    for (user, name) in users {
        let target = user.clone();
        rows = rows.child(
            rune::row()
                .key(format!("mention-{user}"))
                .role("button")
                .label(format!("{name} @{user}"))
                .w_full()
                .h(28.0)
                .px(8.0)
                .gap(8.0)
                .center_y()
                .radius(6.0)
                .hover(c.hover)
                .focusable(true)
                .cursor(rune::Cursor::Pointer)
                .on_press_tx(move |s: &mut State, tx| {
                    s.accept_mention(start, &target);
                    tx.focus("input", false);
                })
                .child(
                    text(name)
                        .font(k.ty.small_medium)
                        .color(c.text_base)
                        .truncate()
                        .a11y_hidden(),
                )
                .child(
                    text(format!("@{user}"))
                        .font(k.ty.small)
                        .color(c.text_muted)
                        .truncate()
                        .a11y_hidden(),
                ),
        );
    }
    layer.push(rune_kit::popover::anchored(
        k,
        rune_kit::popover::raised(k, rows.padding(4.0), k.radius.md),
        "draft",
        rune_kit::Placement::TopStart,
        4.0,
    ));
}

pub(super) fn new_dialog(s: &State, layer: &mut Vec<El>, k: &rune_kit::Kit) {
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
