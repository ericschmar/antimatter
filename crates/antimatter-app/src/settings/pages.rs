use super::model::*;
use super::view::*;
use antimatter_services::settings;
use rune::{El, col, el, row, text};
use rune_kit::{Button, ButtonVariant};

use super::controls::*;

pub(super) fn page(s: &SettingsState, k: &rune_kit::Kit, layer: &mut Vec<El>) -> El {
    let c = &k.c;
    match s.section {
        Section::General => col()
            .w_full()
            .gap(14.0)
            .child(group(
                k,
                vec![
                    stepper_row(
                        k,
                        "Message font size",
                        &font_size_label(s.prefs.message_font_size),
                        "message-font-size",
                        |s| s.change(|p| step_font_size(p, -1)),
                        |s| s.change(|p| step_font_size(p, 1)),
                    ),
                    stepper_row(
                        k,
                        "Message grouping",
                        &grouping_label(s.prefs.message_grouping_interval_minutes),
                        "message-grouping",
                        |s| s.change(|p| step_grouping(p, -1)),
                        |s| s.change(|p| step_grouping(p, 1)),
                    ),
                ],
            ))
            .child(group(
                k,
                vec![
                    row_frame(k, "Software update").child(
                        Button::new("Check for updates")
                            .variant(ButtonVariant::Outline)
                            .on_press_tx(|s: &mut SettingsState, _| {
                                s.update_check = Some("Checking for updates…".into());
                                s.workspace_action(|ws| ws.check_for_update_now());
                            })
                            .build(k)
                            .key("check-for-updates"),
                    ),
                ],
            ))
            .children(s.update_check.as_ref().map(|message| {
                text(message.clone())
                    .font(k.ty.small)
                    .color(c.text_muted)
                    .wrap()
            })),
        Section::Appearance => {
            let mut swatches = row().gap(8.0).center_y();
            for accent in ACCENTS {
                let (r, g, b) = accent_rgb(accent);
                swatches = swatches.child(
                    el().key(format!("accent-{accent:?}"))
                        .role("button")
                        .label(accent_name(accent))
                        .checked(s.prefs.accent_color == accent)
                        .focusable(true)
                        .size(24.0, 24.0)
                        .radius(12.0)
                        .fill(rune::Color { r, g, b, a: 1.0 })
                        .border(
                            2.0,
                            if s.prefs.accent_color == accent {
                                k.c.text_base
                            } else {
                                rune::Color::TRANSPARENT
                            },
                        )
                        .on_press(move |s: &mut SettingsState| {
                            s.change(|p| p.accent_color = accent)
                        }),
                );
            }
            let custom = matches!(s.prefs.accent_color, settings::AccentColor::Custom(..));
            let swatch = el()
                .key("accent-Custom")
                .role("button")
                .label("Custom color")
                .checked(custom)
                .expanded(s.picker_open)
                .focusable(true)
                .size(24.0, 24.0)
                .radius(12.0)
                .clip_rounded(12.0)
                .shape(hue_wheel(24.0))
                .child(
                    el().size(24.0, 24.0)
                        .radius(12.0)
                        .radial_gradient(
                            [0.5, 0.5],
                            12.0,
                            [
                                (0.0, rune::Color::WHITE),
                                (
                                    0.75,
                                    rune::Color {
                                        r: 1.0,
                                        g: 1.0,
                                        b: 1.0,
                                        a: 0.0,
                                    },
                                ),
                            ],
                        )
                        .border(
                            2.0,
                            if custom {
                                k.c.text_base
                            } else {
                                rune::Color::TRANSPARENT
                            },
                        ),
                )
                .on_press(move |s: &mut SettingsState| {
                    s.picker_open = !s.picker_open;
                    s.name_picker_open = false;
                    if let settings::AccentColor::Custom(r, g, b) = s.prefs.accent_color {
                        s.picker_hsv = rgb_to_hsv(r, g, b);
                    }
                });
            let picker = rune_kit::Popover::new("accent-picker")
                .trigger(swatch)
                .label("Custom color")
                .open(s.picker_open)
                .placement(rune_kit::Placement::BottomStart)
                .on_close(|s: &mut SettingsState| s.picker_open = false)
                .child(color_picker(s))
                .build(k, layer);
            swatches = swatches.child(picker);
            let accent_cell = swatches;
            let name_color = s.me.as_deref().map_or(k.c.text_muted, |me| {
                crate::name_colors::color_for(&s.prefs.name_colors, me)
            });
            let name_swatch = el()
                .key("name-color")
                .role("button")
                .label("Name color")
                .expanded(s.name_picker_open)
                .focusable(true)
                .size(24.0, 24.0)
                .radius(12.0)
                .fill(name_color)
                .border(2.0, k.c.border_base)
                .on_press(move |s: &mut SettingsState| {
                    s.name_picker_open = !s.name_picker_open;
                    s.picker_open = false;
                    if let Some(rgb) =
                        s.me.as_deref()
                            .and_then(|me| s.prefs.name_colors.get(me))
                            .and_then(|hex| crate::name_colors::parse(hex))
                    {
                        s.picker_hsv = rgb_to_hsv(rgb.0, rgb.1, rgb.2);
                    }
                });
            let name_picker = rune_kit::Popover::new("name-picker")
                .trigger(name_swatch)
                .label("Name color")
                .open(s.name_picker_open)
                .placement(rune_kit::Placement::BottomStart)
                .on_close(|s: &mut SettingsState| s.name_picker_open = false)
                .child(color_picker(s))
                .build(k, layer);
            let name_cell = el().child(name_picker);
            let font_index = FONTS.iter().position(|f| *f == s.prefs.app_font_family);
            let composer_font_index = FONTS
                .iter()
                .position(|f| *f == s.prefs.composer_font_family);
            let theme_index = THEMES.iter().position(|t| *t == s.prefs.theme);
            let spacing_index = SPACINGS
                .iter()
                .position(|m| *m == s.prefs.timeline_message_spacing);
            col()
                .w_full()
                .gap(14.0)
                .child(group(
                    k,
                    vec![
                        row_frame(k, "Accent color").child(accent_cell),
                        row_frame(k, "Name color").child(name_cell),
                        choice_row(k, "Font", &FONTS.map(font_name), font_index, |s, i, _| {
                            s.change(|p| p.app_font_family = FONTS[i])
                        }),
                        stepper_row(
                            k,
                            "Composer font size",
                            &font_size_label(s.prefs.composer_font_size),
                            "composer-font-size",
                            |s| s.change(|p| step_composer_font_size(p, -1)),
                            |s| s.change(|p| step_composer_font_size(p, 1)),
                        ),
                        choice_row(
                            k,
                            "Composer font",
                            &FONTS.map(font_name),
                            composer_font_index,
                            |s, i, _| s.change(|p| p.composer_font_family = FONTS[i]),
                        ),
                        choice_row(
                            k,
                            "Theme",
                            &THEMES.map(theme_name),
                            theme_index,
                            |s, i, _| s.change(|p| p.theme = THEMES[i]),
                        ),
                    ],
                ))
                .child(group(
                    k,
                    vec![
                        toggle_row(
                            k,
                            "Use compact message timeline",
                            s.prefs.compact_timeline,
                            "compact-timeline",
                            |s| s.change(|p| p.compact_timeline = !p.compact_timeline),
                        ),
                        choice_row(
                            k,
                            "Message spacing",
                            &SPACINGS.map(spacing_name),
                            spacing_index,
                            |s, i, _| s.change(|p| p.timeline_message_spacing = SPACINGS[i]),
                        ),
                        toggle_row(
                            k,
                            "Show user avatars",
                            s.prefs.show_timeline_avatars,
                            "show-avatars",
                            |s| s.change(|p| p.show_timeline_avatars = !p.show_timeline_avatars),
                        ),
                        stepper_row(
                            k,
                            "Avatar size",
                            &avatar_size_label(s.prefs.timeline_avatar_size),
                            "avatar-size",
                            |s| s.change(|p| step_avatar_size(p, -1)),
                            |s| s.change(|p| step_avatar_size(p, 1)),
                        ),
                    ],
                ))
        }
        Section::Notifications => col()
            .w_full()
            .gap(14.0)
            .child(group(
                k,
                vec![
                    toggle_row(
                        k,
                        "Enable notifications",
                        s.prefs.notifications_enabled,
                        "notifications-enabled",
                        |s| s.change(|p| p.notifications_enabled = !p.notifications_enabled),
                    ),
                    toggle_row(
                        k,
                        "Play notification sounds",
                        s.prefs.notification_sounds_enabled,
                        "notification-sounds",
                        |s| {
                            s.change(|p| {
                                p.notification_sounds_enabled = !p.notification_sounds_enabled
                            })
                        },
                    ),
                ],
            ))
            .child(server_notifications(s, k)),
        Section::Workspace => group(
            k,
            vec![
                toggle_row(
                    k,
                    "Open channels as previews",
                    s.prefs.workspace_open_previews,
                    "open-previews",
                    |s| s.change(|p| p.workspace_open_previews = !p.workspace_open_previews),
                ),
                toggle_row(
                    k,
                    "Open direct messages in a new window",
                    s.prefs.automatically_open_direct_messages_in_new_window,
                    "dm-new-window",
                    |s| {
                        s.change(|p| {
                            p.automatically_open_direct_messages_in_new_window =
                                !p.automatically_open_direct_messages_in_new_window
                        })
                    },
                ),
            ],
        ),
        Section::KeyboardShortcuts => group(
            k,
            SHORTCUTS
                .iter()
                .map(|(action, keys)| {
                    row_frame(k, action).child(text(*keys).font(k.ty.mono).color(c.text_muted))
                })
                .collect(),
        ),
        Section::Profile => profile_page(s, k),
        Section::Accounts => {
            let mut card = col().w_full().gap(0.0);
            if s.accounts.is_empty() {
                card = card.child(
                    row_frame(k, "No saved accounts").child(
                        text("Sign in to save an account.")
                            .font(k.ty.text_small)
                            .color(c.text_muted),
                    ),
                );
            }
            for account in &s.accounts {
                let name = format!("{} · {}", account.origin, account.username);
                let mut row = row_frame(k, &name);
                if account.active {
                    row = row.child(text("Active").font(k.ty.text_small).color(c.bg_accent));
                } else {
                    let key = account.key.clone();
                    row = row.child(
                        Button::new("Switch")
                            .variant(ButtonVariant::Outline)
                            .on_press_tx(move |s: &mut SettingsState, _| {
                                let key = key.clone();
                                s.workspace_action(move |ws| ws.switch_account(key))
                            })
                            .build(k)
                            .key(format!("switch-{}", account.origin)),
                    );
                }
                let key = account.key.clone();
                row = row.child(
                    Button::new("Disconnect")
                        .variant(ButtonVariant::Danger)
                        .on_press_tx(move |s: &mut SettingsState, _| {
                            let key = key.clone();
                            s.workspace_action(move |ws| ws.remove_account(key))
                        })
                        .build(k)
                        .key(format!("disconnect-{}", account.origin)),
                );
                card = card.child(row);
            }
            col().w_full().gap(14.0).child(group(k, vec![card])).child(
                Button::new("Add account")
                    .variant(ButtonVariant::Contrast)
                    .on_press_tx(|s: &mut SettingsState, _| {
                        s.workspace_action(|ws| ws.add_account())
                    })
                    .build(k)
                    .key("add-account"),
            )
        }
    }
}

pub(super) fn server_notifications(s: &SettingsState, k: &rune_kit::Kit) -> El {
    let n = &s.notify;
    let c = &k.c;
    if !n.loaded {
        return text(
            n.message.clone().unwrap_or_else(|| {
                "Mattermost preferences load once a server is connected.".into()
            }),
        )
        .font(k.ty.small)
        .color(c.text_muted)
        .wrap();
    }
    const TRIPLE: [&str; 3] = ["All", "Mentions", "None"];
    const TRIPLE_VALUES: [&str; 3] = ["all", "mention", "none"];
    const REPLIES: [&str; 3] = ["Any", "Mine", "None"];
    const REPLY_VALUES: [&str; 3] = ["any", "root", "never"];
    let at = |values: &[&str], current: String| values.iter().position(|v| *v == current);
    let flag = |key: &str| n.get(key, "true") == "true";
    let mut page = col().w_full().gap(14.0).child(group(
        k,
        vec![
            choice_row(
                k,
                "Desktop notifications",
                &TRIPLE,
                at(&TRIPLE_VALUES, n.get("desktop", "mention")),
                |s, i, _| {
                    let v = TRIPLE_VALUES[i].to_owned();
                    s.workspace_action(move |ws| ws.set_notify_prop("desktop", v));
                },
            ),
            toggle_row(
                k,
                "Email notifications",
                flag("email"),
                "notify-email",
                |s| {
                    let next = if s.notify.get("email", "true") == "true" {
                        "false"
                    } else {
                        "true"
                    };
                    s.workspace_action(move |ws| ws.set_notify_prop("email", next.into()));
                },
            ),
            choice_row(
                k,
                "Push notifications",
                &TRIPLE,
                at(&TRIPLE_VALUES, n.get("push", "mention")),
                |s, i, _| {
                    let v = TRIPLE_VALUES[i].to_owned();
                    s.workspace_action(move |ws| ws.set_notify_prop("push", v));
                },
            ),
            toggle_row(
                k,
                "Mention notifications",
                flag("channel"),
                "notify-channel",
                |s| {
                    let next = if s.notify.get("channel", "true") == "true" {
                        "false"
                    } else {
                        "true"
                    };
                    s.workspace_action(move |ws| ws.set_notify_prop("channel", next.into()));
                },
            ),
            choice_row(
                k,
                "Thread reply notifications",
                &REPLIES,
                at(&REPLY_VALUES, n.get("comments", "never")),
                |s, i, _| {
                    let v = REPLY_VALUES[i].to_owned();
                    s.workspace_action(move |ws| ws.set_notify_prop("comments", v));
                },
            ),
        ],
    ));
    if !n.channels.is_empty() {
        page = page.child(
            text("Channel notification levels")
                .font(k.ty.small_medium)
                .color(c.text_muted),
        );
        let labels: [&str; 4] = [
            crate::notifications::LEVELS[0].1,
            crate::notifications::LEVELS[1].1,
            crate::notifications::LEVELS[2].1,
            crate::notifications::LEVELS[3].1,
        ];
        let rows = n
            .channels
            .iter()
            .map(|(id, name, level)| {
                let id = id.clone();
                choice_row(
                    k,
                    name,
                    &labels,
                    crate::notifications::LEVELS
                        .iter()
                        .position(|(v, _)| v == level),
                    move |s, i, _| {
                        let id = id.clone();
                        let level = crate::notifications::LEVELS[i].0;
                        s.workspace_action(move |ws| ws.set_channel_level(id, level));
                    },
                )
            })
            .collect();
        page = page.child(group(k, rows));
    }
    if let Some(message) = &n.message {
        page = page.child(
            text(message.clone())
                .font(k.ty.small)
                .color(c.danger.fg)
                .wrap(),
        );
    }
    page
}

pub(super) fn profile_page(s: &SettingsState, k: &rune_kit::Kit) -> El {
    let p = &s.profile;
    let input =
        |label: &str, edit: &rune::TextEdit, on: fn(&mut SettingsState) -> &mut rune::TextEdit| {
            row_frame(k, label).child(
                rune_kit::TextInput::new(edit)
                    .label(label)
                    .placeholder(label)
                    .width(Some(260.0))
                    .height(28.0)
                    .on_edit(on)
                    .build(k)
                    .key(format!(
                        "profile-{}",
                        label.to_lowercase().replace(' ', "-")
                    )),
            )
        };
    let names: Vec<&str> = crate::profile::STATUSES.iter().map(|(_, n)| *n).collect();
    let names: [&str; 4] = [names[0], names[1], names[2], names[3]];
    let mut page = col().w_full().gap(14.0);
    page = page.child(group(
        k,
        vec![
            row_frame(k, "Photo").child(
                Button::new("Choose photo")
                    .variant(ButtonVariant::Outline)
                    .on_press_tx(|_: &mut SettingsState, tx| {
                        let options = rune::FileDialogOptions {
                            title: "Choose photo".into(),
                            ..Default::default()
                        }
                        .filter("Images", &["png", "jpg", "jpeg", "gif", "webp"]);
                        tx.open_file(options, |s: &mut SettingsState, result, _| {
                            if let Ok(Some(path)) = result {
                                s.workspace_action(move |ws| ws.upload_avatar(path));
                            }
                        });
                    })
                    .build(k)
                    .key("profile-photo"),
            ),
        ],
    ));
    page = page.child(group(
        k,
        vec![
            input("First name", &p.first_name, |s| &mut s.profile.first_name),
            input("Last name", &p.last_name, |s| &mut s.profile.last_name),
            input("Nickname", &p.nickname, |s| &mut s.profile.nickname),
            input("Username", &p.username, |s| &mut s.profile.username),
            input("Email", &p.email, |s| &mut s.profile.email),
            input("Custom status", &p.custom_status, |s| {
                &mut s.profile.custom_status
            }),
            choice_row(k, "Status", &names, Some(p.status), |s, i, _| {
                s.profile.status = i
            }),
        ],
    ));
    if let Some(message) = &p.message {
        page = page.child(
            text(message.clone())
                .font(k.ty.text_small)
                .color(k.c.text_muted),
        );
    }
    page.child(
        Button::new(if p.busy { "Saving…" } else { "Save profile" })
            .variant(ButtonVariant::Contrast)
            .disabled(p.busy || !p.loaded)
            .on_press_tx(|s: &mut SettingsState, _| {
                let p = &mut s.profile;
                p.busy = true;
                p.message = None;
                let values = [
                    p.first_name.text.clone(),
                    p.last_name.text.clone(),
                    p.nickname.text.clone(),
                    p.username.text.clone(),
                    p.email.text.clone(),
                    p.custom_status.text.clone(),
                ];
                let status = crate::profile::STATUSES[p.status].0;
                s.workspace_action(move |ws| ws.save_profile(values, status));
            })
            .build(k)
            .key("profile-save"),
    )
}
