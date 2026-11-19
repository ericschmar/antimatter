use super::*;

pub(super) fn attach_button(
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

pub(super) fn typing_indicator(s: &State, k: &rune_kit::Kit) -> Option<El> {
    let mut names: Vec<&str> = s
        .typing
        .keys()
        .map(|id| s.names.get(id).map_or(id.as_str(), String::as_str))
        .collect();
    names.sort_unstable();
    let label = match names.as_slice() {
        [] => return None,
        [one] => format!("{one} is typing"),
        [one, two] => format!("{one} and {two} are typing"),
        [one, rest @ ..] => format!("{one} and {} others are typing", rest.len()),
    };
    Some(
        rune::row()
            .key("typing-indicator")
            .h(26.0)
            .px(10.0)
            .center_y()
            .radius(13.0)
            .fill(k.c.layer_02)
            .border(1.0, k.c.border_base)
            .child(
                text(label)
                    .font(k.ty.small)
                    .color(k.c.text_muted)
                    .label("Typing"),
            ),
    )
}

pub(super) fn reply_chip(s: &State, k: &rune_kit::Kit) -> Option<El> {
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

pub(super) fn edit_chip(s: &State, k: &rune_kit::Kit) -> Option<El> {
    let post = s.editing.as_ref()?;
    let snippet = post
        .message
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or_default()
        .to_owned();
    Some(
        rune::row()
            .key("edit-chip")
            .w_full()
            .gap(6.0)
            .center_y()
            .child(
                icon(&icons::PENCIL_SIMPLE, 12.0)
                    .color(k.c.icon_muted)
                    .a11y_hidden(),
            )
            .child(
                text("Editing message")
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
                    .label("Cancel edit")
                    .control_size(ControlSize::Small)
                    .variant(IconButtonVariant::Ghost)
                    .on_press(|s: &mut State| s.cancel_edit())
                    .build(k)
                    .key("edit-cancel"),
            ),
    )
}

pub(super) fn attachment_pills(s: &State, k: &rune_kit::Kit) -> Option<El> {
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
