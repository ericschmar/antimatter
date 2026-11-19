use super::*;

pub(super) fn emoji_glyph(name: &str) -> String {
    emoji_lookup(name).map_or_else(|| format!(":{name}:"), |e| e.as_str().to_owned())
}

pub(super) fn emoji_lookup(name: &str) -> Option<&'static emojis::Emoji> {
    emojis::get_by_shortcode(name)
        .or_else(|| emojis::iter().find(|e| name.split('_').eq(e.name().split(' '))))
}

pub(super) fn emoji_face(s: &State, name: &str, size: f32, k: &rune_kit::Kit) -> El {
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

pub(super) const EMOJI_TABS: [emojis::Group; 9] = [
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

pub(super) fn emoji_picker_trigger(s: &State, post: &Post, k: &rune_kit::Kit) -> El {
    let open = s.emoji_picker.as_deref() == Some(post.id.as_str());
    let id = post.id.clone();
    rune::row()
        .key(format!("emoji-picker-{}-trigger", post.id))
        .child(
            IconButton::new(&icons::SMILEY)
                .label("Add reaction")
                .control_size(ControlSize::Small)
                .variant(IconButtonVariant::Ghost)
                .on_press(move |s: &mut State| {
                    s.emoji_query = TextEdit::default();
                    s.emoji_picker = Some(id.clone());
                })
                .build(k)
                .key("post-react")
                .expanded(open),
        )
}

pub(super) fn emoji_picker(s: &State, post: &Post, k: &rune_kit::Kit, layer: &mut Vec<El>) {
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
    rune_kit::Popover::new(format!("emoji-picker-{}", post.id))
        .open(true)
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
                                .caret(s.caret(c.text_base), k.selection())
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
        .build(k, layer);
}

pub(super) fn reaction_pills(s: &State, post: &Post, k: &rune_kit::Kit) -> Option<El> {
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

#[cfg(test)]
mod emoji_glyph_tests {
    use super::emoji_glyph;

    #[test]
    fn reaction_names_resolve_to_their_glyph() {
        assert_eq!(emoji_glyph("+1"), "👍");
        assert_eq!(emoji_glyph("rofl"), "🤣");
        assert_eq!(emoji_glyph("rolling_on_the_floor_laughing"), "🤣");
        assert_eq!(emoji_glyph("not_a_real_emoji"), ":not_a_real_emoji:");
    }
}
