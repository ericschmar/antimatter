use super::*;

pub(super) fn thread_panel(s: &State, locked: bool, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let count = s.thread.as_ref().map_or(0, |t| t.posts.len());
    let (composer, toolbar) = crate::composer::thread_composer(s, locked);
    let mut pills = rune::row()
        .key("thread-attachments")
        .w_full()
        .gap(6.0)
        .flex_wrap();
    for (i, path) in s.thread_attachments.iter().enumerate() {
        let name = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        pills = pills.child(
            rune::row()
                .key(format!("thread-attachment-{i}"))
                .h(26.0)
                .pl(10.0)
                .pr(2.0)
                .gap(4.0)
                .center_y()
                .radius(13.0)
                .fill(c.layer_02)
                .border(1.0, c.border_base)
                .child(
                    text(name.clone())
                        .font(k.ty.small)
                        .color(c.text_base)
                        .truncate()
                        .a11y_hidden(),
                )
                .child(
                    IconButton::new(&icons::X)
                        .label(format!("Remove {name}"))
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press(move |s: &mut State| {
                            if i < s.thread_attachments.len() {
                                s.thread_attachments.remove(i);
                            }
                        })
                        .build(k)
                        .key(format!("thread-attachment-remove-{i}")),
                ),
        );
    }
    let attach = |key: &'static str, label: &'static str, glyph: &'static Icon, images: bool| {
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
                    options =
                        options.filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "heic"]);
                }
                tx.open_file(options, |s: &mut State, result, _| {
                    if let Ok(Some(path)) = result {
                        s.attach_thread(&[path]);
                    }
                });
            })
            .build(k)
            .key(key);
        if locked { b.inert() } else { b }
    };
    let disabled = locked
        || s.channel.is_none()
        || (s.thread_markdown().trim().is_empty() && s.thread_attachments.is_empty());
    let send = Button::new("Reply")
        .variant(ButtonVariant::Contrast)
        .disabled(disabled)
        .on_press_tx(|s: &mut State, tx| {
            s.send_thread();
            tx.focus("thread-draft", false);
        })
        .build(k)
        .key("thread-send");
    col()
        .key("thread-panel")
        .w(s.thread_panel.width())
        .shrink()
        .h_full()
        .fill(c.layer_01)
        .child(
            rune::row()
                .w_full()
                .h(TITLEBAR)
                .px(16.0)
                .gap(8.0)
                .center_y()
                .child(
                    text(if count > 1 {
                        format!("Thread · {} replies", count - 1)
                    } else {
                        "Thread".to_owned()
                    })
                    .font(k.ty.body_medium)
                    .color(c.text_base)
                    .grow(1.0),
                )
                .child(
                    IconButton::new(&icons::X)
                        .label("Close thread")
                        .control_size(ControlSize::Small)
                        .variant(IconButtonVariant::Ghost)
                        .on_press(|s: &mut State| s.close_thread_pane())
                        .build(k)
                        .key("thread-close"),
                ),
        )
        .child(
            col()
                .key("thread-timeline")
                .grow(1.0)
                .min_h(0.0)
                .scroll(rune::ScrollSpec { stick_bottom: true })
                .scroll_anchor()
                .child(
                    col()
                        .key("thread-rows")
                        .w_full()
                        .growth(rune::GrowthSpec::default())
                        .virtual_rows(
                            count,
                            72.0,
                            |s: &State, i| {
                                let id = s.thread.as_ref().map_or("", |t| t.posts[i].id.as_str());
                                format!("thread-post-{id}").into()
                            },
                            |s: &State, i| thread_post_row(s, i),
                        ),
                )
                .scroll_bar_styled(ScrollBarStyle::scroll_view(k)),
        )
        .child(
            col()
                .w_full()
                .px(16.0)
                .py(8.0)
                .gap(8.0)
                .fill(c.layer_01)
                .children((!s.thread_attachments.is_empty()).then_some(pills))
                .child(composer)
                .child(
                    rune::row()
                        .w_full()
                        .gap(8.0)
                        .center_y()
                        .child(toolbar)
                        .child(attach(
                            "thread-attach-image",
                            "Attach image",
                            &icons::IMAGE,
                            true,
                        ))
                        .child(attach(
                            "thread-attach-file",
                            "Attach file",
                            &icons::PAPERCLIP,
                            false,
                        ))
                        .child(if disabled { send.inert() } else { send }),
                ),
        )
}
