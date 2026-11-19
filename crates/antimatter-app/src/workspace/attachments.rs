use super::*;

pub(super) fn image_attachments(post: &Post, s: &State, k: &rune_kit::Kit) -> Option<El> {
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
        [] => None,
        [file] => {
            let target = (*file).clone();
            if let Some(image) = s.gifs.get(&format!("file:{}", file.id)) {
                let picture = el()
                    .key(format!("image-{}", file.id))
                    .role("image")
                    .label(file.name.clone())
                    .max_w(GIF_MAX_W)
                    .max_h(GIF_MAX_H)
                    .radius(6.0)
                    .cursor(rune::Cursor::Pointer)
                    .focusable(true)
                    .on_press(move |s: &mut State| s.open_file(target.clone()))
                    .pixels(image.pixels());
                let [w, h] = image.size().unwrap_or([GIF_MAX_W as u32, GIF_MAX_H as u32]);
                let ratio = w as f32 / (h.max(1) as f32);
                return Some(rune::row().child(picture.aspect_fit(ratio)));
            }
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
            Some(
                rune::row()
                    .key(format!("images-menu-{}-trigger", post.id))
                    .child(stack.child(trigger)),
            )
        }
    }
}

pub(super) fn image_menu(s: &State, post: &Post, k: &rune_kit::Kit, layer: &mut Vec<El>) {
    let images: Vec<_> = post
        .metadata
        .files
        .iter()
        .filter(|f| f.is_image())
        .collect();
    if images.len() < 2 || s.image_menu.as_deref() != Some(post.id.as_str()) {
        return;
    }
    let mut menu = rune_kit::Menu::new(format!("images-menu-{}", post.id))
        .open(true)
        .on_close(|s: &mut State| s.image_menu = None);
    for file in images {
        let target = (*file).clone();
        menu = menu.item(
            MenuItem::new(file.name.clone()).on_select(move |s: &mut State| {
                s.image_menu = None;
                s.open_file(target.clone());
            }),
        );
    }
    menu.build(k, layer);
}

pub(super) const GIF_MAX_W: f32 = 320.0;
pub(super) const GIF_MAX_H: f32 = 240.0;

pub(crate) fn single_image(post: &Post) -> Option<&antimatter_services::mattermost::FileInfo> {
    let mut images = post.metadata.files.iter().filter(|f| f.is_image());
    let first = images.next()?;
    images.next().is_none().then_some(first)
}

pub(crate) fn gif_sources(message: &str) -> Vec<url::Url> {
    let mut sources = Vec::new();
    let mut rest = message;
    while let Some(start) = rest.find("![") {
        let after = &rest[start..];
        let Some(open) = after.find("](") else { break };
        let src = &after[open + 2..];
        let Some(end) = src.find(')') else { break };
        if let Ok(url) = url::Url::parse(&src[..end])
            && matches!(url.scheme(), "http" | "https")
        {
            sources.push(url);
        }
        rest = &src[end..];
    }
    sources
}

pub(super) fn link_preview(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
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

pub(super) fn file_attachments(post: &Post, k: &rune_kit::Kit) -> Option<El> {
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
                .on_press_tx(move |s: &mut State, tx| s.download_file(target.clone(), tx))
                .child(icon(&icons::FILE, 24.0).color(k.c.icon_muted).a11y_hidden())
                .child(
                    col()
                        .grow(1.0)
                        .min_w(0.0)
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

pub(super) fn file_size(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 20 => format!("{:.1} MB", b as f64 / f64::from(1 << 20)),
        b if b >= 1 << 10 => format!("{:.1} KB", b as f64 / f64::from(1 << 10)),
        b => format!("{b} B"),
    }
}

pub(super) fn open_channel_files(s: &State) -> &[antimatter_services::mattermost::FileInfo] {
    s.channel_files_list
        .as_ref()
        .filter(|(channel, _)| s.channel.as_deref() == Some(channel.as_str()))
        .map_or(&[], |(_, files)| files.as_slice())
}

pub(super) fn channel_files_panel(s: &State, k: &rune_kit::Kit) -> El {
    let c = &k.c;
    let files = open_channel_files(s);
    let mut list = col().w_full().gap(4.0);
    for file in files {
        let target = file.clone();
        list = list.child(
            rune::row()
                .key(format!("channel-file-{}", file.id))
                .role("button")
                .label(format!("Download {}", file.name))
                .w_full()
                .padding(8.0)
                .gap(10.0)
                .center_y()
                .radius(8.0)
                .cursor(rune::Cursor::Pointer)
                .focusable(true)
                .on_press_tx(move |s: &mut State, tx| s.download_file(target.clone(), tx))
                .child(icon(&icons::FILE, 20.0).color(c.icon_muted).a11y_hidden())
                .child(
                    col().grow(1.0).min_w(0.0).child(
                        text(file.name.clone())
                            .font(k.ty.small_medium)
                            .color(c.text_base)
                            .truncate()
                            .a11y_hidden(),
                    ),
                ),
        );
    }
    if files.is_empty() {
        list = list.child(
            text("No files in this channel yet.")
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap(),
        );
    }
    col()
        .key("channel-files")
        .w(264.0)
        .shrink()
        .h_full()
        .fill(c.layer_01)
        .child(
            rune::row().w_full().h(TITLEBAR).px(16.0).center_y().child(
                text("Files")
                    .font(k.ty.body_medium)
                    .color(c.text_base)
                    .grow(1.0),
            ),
        )
        .child(
            list.px(8.0)
                .pb(8.0)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .scroll_bar_styled(ScrollBarStyle::scroll_view(k))
                .grow(1.0)
                .min_h(0.0),
        )
}

#[cfg(test)]
mod gif_source_tests {
    use super::gif_sources;

    #[test]
    fn collects_each_http_image_source_and_ignores_the_rest() {
        let m = "hi ![a](https://media.giphy.com/a.gif) ![b](http://x.test/b.gif) ![c](ftp://no/c) [l](https://x.test/d)";
        let urls: Vec<_> = gif_sources(m).into_iter().map(|u| u.to_string()).collect();
        assert_eq!(
            urls,
            ["https://media.giphy.com/a.gif", "http://x.test/b.gif"]
        );
    }
}

#[cfg(test)]
mod channel_files_tests {
    use super::open_channel_files;
    use crate::state::State;
    use antimatter_services::mattermost::FileInfo;

    #[test]
    fn panel_lists_only_files_for_the_open_channel() {
        let mut s = State {
            channel: Some("chan-a".into()),
            ..State::default()
        };
        s.channel_files_list = Some((
            "chan-a".into(),
            vec![FileInfo {
                id: "a".into(),
                ..Default::default()
            }],
        ));
        assert_eq!(open_channel_files(&s).len(), 1);
        s.channel = Some("chan-b".into());
        assert!(open_channel_files(&s).is_empty());
        s.channel = None;
        assert!(open_channel_files(&s).is_empty());
    }
}
