use super::model::*;
use crate::workspace::TITLEBAR;
use antimatter_services::settings::{self, Settings};
use rune::{El, col, el, row, text};
use rune_kit::{Button, ButtonVariant, Switch};
use std::path::PathBuf;

/// The Settings window's own state. It holds no workspace data of its own: the account rows
/// are mirrored from the workspace, and account actions are sent back through it.
pub(crate) struct SettingsState {
    pub(crate) prefs: Settings,
    pub(crate) path: Option<PathBuf>,
    pub(crate) section: Section,
    pub(crate) error: Option<String>,
    /// Set while `settings.json` is unreadable: its defaults are shown, and no write may
    /// replace the file that failed to load.
    pub(crate) read_only: bool,
    /// Saved accounts mirrored from the workspace; account actions go back through it.
    pub(crate) accounts: Vec<AccountRow>,
    pub(crate) workspace: Option<rune::AppHandle<crate::state::State>>,
    pub(crate) profile: crate::profile::ProfileForm,
    pub(crate) notify: crate::notifications::ServerNotify,
    /// The custom-colour picker is expanded, and its colour as hue, saturation, value.
    pub(crate) picker_open: bool,
    pub(crate) picker_hsv: (f32, f32, f32),
}

/// One saved account as Settings shows it. The workspace owns the account data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AccountRow {
    pub(crate) key: antimatter_services::accounts::AccountKey,
    pub(crate) origin: String,
    pub(crate) username: String,
    pub(crate) active: bool,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self::new(Settings::default(), None, None)
    }
}

impl SettingsState {
    /// Runs an account action on the workspace's UI thread. Without a workspace handle
    /// (headless or before sign-in storage starts) the action is inert.
    pub(crate) fn workspace_action(
        &self,
        action: impl FnOnce(&mut crate::state::State) + Send + 'static,
    ) {
        if let Some(workspace) = &self.workspace {
            workspace.update(move |s, _| action(s));
        }
    }

    pub(crate) fn new(prefs: Settings, path: Option<PathBuf>, load_error: Option<String>) -> Self {
        Self {
            prefs,
            path,
            section: Section::General,
            read_only: load_error.is_some(),
            error: load_error,
            accounts: Vec::new(),
            workspace: None,
            profile: Default::default(),
            notify: Default::default(),
            picker_open: false,
            picker_hsv: (0.0, 0.0, 1.0),
        }
    }

    /// Applies a change, then persists it. A failed write restores the last persisted
    /// value and reports the failure. An unreadable file is never written.
    pub(crate) fn change(&mut self, edit: impl FnOnce(&mut Settings)) {
        if self.read_only {
            return;
        }
        let previous = self.prefs.clone();
        edit(&mut self.prefs);
        match &self.path {
            Some(path) => match settings::save(path, &self.prefs) {
                Ok(()) => self.error = None,
                Err(error) => {
                    self.prefs = previous;
                    self.error = Some(format!("Could not save settings: {error}"));
                }
            },
            None => self.error = None,
        }
        let message_font_size = self.prefs.message_font_size;
        let message_spacing = self.prefs.timeline_message_spacing;
        let show_timeline_avatars = self.prefs.show_timeline_avatars;
        let accent = self.prefs.accent_color;
        let notify = (
            self.prefs.notifications_enabled,
            self.prefs.notification_sounds_enabled,
        );
        let theme = theme_for(self.prefs.theme);
        self.workspace_action(move |ws| {
            ws.accent = accent;
            ws.notifications_enabled = notify.0;
            ws.notification_sounds_enabled = notify.1;
            ws.theme = theme;
            ws.message_font_size = message_font_size;
            ws.message_spacing = message_spacing;
            ws.show_timeline_avatars = show_timeline_avatars;
        });
    }
}

pub(crate) fn theme_for(pref: settings::ThemePreference) -> antimatter_theme::Theme {
    use antimatter_theme::Theme;
    match pref {
        settings::ThemePreference::Light => Theme::Light,
        settings::ThemePreference::Dark => Theme::Warm,
        settings::ThemePreference::System => {
            let dark = std::process::Command::new("defaults")
                .args(["read", "-g", "AppleInterfaceStyle"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(true);
            if dark { Theme::Warm } else { Theme::Light }
        }
    }
}

pub(crate) fn settings_view(s: &SettingsState, _: &mut rune::Cx<SettingsState>) -> El {
    let mut layer = Vec::new();
    let k = crate::theme::with_accent(s.prefs.accent_color);
    let c = &k.c;
    let mut sidebar = col()
        .w(190.0)
        .shrink()
        .min_w(175.0)
        .h_full()
        .fill(c.layer_01)
        .py(12.0)
        .px(8.0)
        .gap(2.0)
        .child(el().w_full().h(TITLEBAR).window_drag());
    for section in Section::ALL {
        let selected = s.section == section;
        sidebar = sidebar.child(
            row()
                .key(format!("settings-section-{}", section.title()))
                .role("button")
                .label(section.title())
                .checked(selected)
                .focusable(true)
                .w_full()
                .h(28.0)
                .px(12.0)
                .center_y()
                .radius(6.0)
                .fill(if selected { c.bg_accent } else { c.layer_01 })
                .on_press_tx(move |s: &mut SettingsState, tx: &mut rune::Tx| {
                    tx.instant();
                    s.section = section;
                    if section == Section::Notifications && !s.notify.loaded {
                        s.workspace_action(|ws| ws.load_notify());
                    }
                    if section == Section::Profile && !s.profile.loaded {
                        s.workspace_action(|ws| ws.load_profile());
                    }
                })
                .child(
                    text(section.title())
                        .font(k.ty.text_small)
                        .color(if selected { c.text_base } else { c.text_muted }),
                ),
        );
    }
    let mut detail = col()
        .grow(1.0)
        .min_w(0.0)
        .min_h(0.0)
        .h_full()
        .px(36.0)
        .child(el().w_full().h(TITLEBAR).window_drag())
        .gap(14.0)
        .child(
            text(s.section.title())
                .font(k.ty.ui_medium)
                .color(c.text_base),
        )
        .child(
            text(s.section.subtitle())
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap(),
        );
    if let Some(error) = &s.error {
        detail = detail.child(text(error.as_str()).color(c.warning.fg).wrap());
    }
    detail = detail.child(
        col()
            .w_full()
            .grow(1.0)
            .min_h(0.0)
            .pb(30.0)
            .scroll(rune::ScrollSpec {
                stick_bottom: false,
            })
            .transition(rune::Transition::none())
            .child(page(s, &k, &mut layer)),
    );
    let base = row()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(sidebar)
        .child(detail.max_w(520.0));
    rune_kit::root(base, layer)
}

fn page(s: &SettingsState, k: &rune_kit::Kit, layer: &mut Vec<El>) -> El {
    let c = &k.c;
    match s.section {
        Section::General => group(
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
        ),
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
            let font_index = FONTS.iter().position(|f| *f == s.prefs.app_font_family);
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
                        choice_row(k, "Font", &FONTS.map(font_name), font_index, |s, i, _| {
                            s.change(|p| p.app_font_family = FONTS[i])
                        }),
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

fn server_notifications(s: &SettingsState, k: &rune_kit::Kit) -> El {
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

fn profile_page(s: &SettingsState, k: &rune_kit::Kit) -> El {
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

fn group(k: &rune_kit::Kit, rows: Vec<El>) -> El {
    let mut card = col()
        .w_full()
        .radius(8.0)
        .border(1.0, k.c.border_base)
        .fill(k.c.layer_01);
    for row in rows {
        card = card.child(row);
    }
    card
}

fn row_frame(k: &rune_kit::Kit, label: &str) -> El {
    row()
        .w_full()
        .h(44.0)
        .px(16.0)
        .gap(12.0)
        .center_y()
        .label(label)
        .child(
            text(label)
                .font(k.ty.text_small)
                .color(k.c.text_base)
                .grow(1.0)
                .truncate(),
        )
}

fn toggle_row(
    k: &rune_kit::Kit,
    label: &str,
    on: bool,
    key: &str,
    toggle: fn(&mut SettingsState),
) -> El {
    row_frame(k, label).child(
        Switch::new(on)
            .label(label)
            .hide_label()
            .on_toggle(toggle)
            .build(k)
            .key(key),
    )
}

fn stepper_row(
    k: &rune_kit::Kit,
    label: &str,
    value: &str,
    key: &str,
    minus: fn(&mut SettingsState),
    plus: fn(&mut SettingsState),
) -> El {
    row_frame(k, label)
        .child(text(value).font(k.ty.text_small).color(k.c.text_muted))
        .child(
            Button::new("−")
                .variant(ButtonVariant::Outline)
                .on_press(minus)
                .build(k)
                .key(format!("{key}-minus")),
        )
        .child(
            Button::new("+")
                .variant(ButtonVariant::Outline)
                .on_press(plus)
                .build(k)
                .key(format!("{key}-plus")),
        )
}

/// A hue wheel (hue by angle) as a fan of wedges in a `size` square.
fn hue_wheel(size: f32) -> rune::Shape {
    const WEDGES: usize = 72;
    let (c, r) = (size / 2.0, size / 2.0 + 0.5);
    let mut shape = rune::Shape::new();
    for i in 0..WEDGES {
        let (a0, a1) = (i as f32 / WEDGES as f32, (i + 1) as f32 / WEDGES as f32);
        let point = |t: f32| {
            let angle = t * std::f32::consts::TAU;
            [c + r * angle.cos(), c + r * angle.sin()]
        };
        let (cr, cg, cb) = hsv_to_rgb((a0 + a1) / 2.0, 1.0, 1.0);
        let color = rune::Color {
            r: cr as f32 / 255.0,
            g: cg as f32 / 255.0,
            b: cb as f32 / 255.0,
            a: 1.0,
        };
        shape = shape.fill(vec![[c, c], point(a0 - 0.002), point(a1 + 0.002)], color);
    }
    shape
}

fn rainbow_stops() -> Vec<(f32, rune::Color)> {
    (0..=6)
        .map(|i| {
            let (r, g, b) = hsv_to_rgb(i as f32 / 6.0, 1.0, 1.0);
            (
                i as f32 / 6.0,
                rune::Color {
                    r: r as f32 / 255.0,
                    g: g as f32 / 255.0,
                    b: b as f32 / 255.0,
                    a: 1.0,
                },
            )
        })
        .collect()
}

fn apply_hsv(s: &mut SettingsState, hsv: (f32, f32, f32)) {
    s.picker_hsv = hsv;
    let (r, g, b) = hsv_to_rgb(hsv.0, hsv.1, hsv.2);
    // ponytail: every drag step persists settings.json; upgrade is saving on pointer-up only.
    s.change(|p| p.accent_color = settings::AccentColor::Custom(r, g, b));
}

/// A saturation/value square over the chosen hue, and a hue strip.
fn color_picker(s: &SettingsState) -> El {
    use rune::Color;
    let (h, sat, val) = s.picker_hsv;
    let unit = |x: f32, w: f32| (x / w.max(1.0)).clamp(0.0, 1.0);
    let (hr, hg, hb) = hsv_to_rgb(h, 1.0, 1.0);
    let hue = Color {
        r: hr as f32 / 255.0,
        g: hg as f32 / 255.0,
        b: hb as f32 / 255.0,
        a: 1.0,
    };
    let white = Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };
    let clear = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };
    let black = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };
    let (w, hgt) = (220.0, 120.0);
    let square = el()
        .key("picker-square")
        .role("slider")
        .label("Saturation and brightness")
        .size(w, hgt)
        .radius(6.0)
        .fill(hue)
        .clip_rounded(6.0)
        .child(
            el().w_full()
                .h_full()
                .linear_gradient(std::f32::consts::FRAC_PI_2, [(0.0, white), (1.0, clear)]),
        )
        .child(
            el().w_full()
                .h_full()
                .absolute(0.0, 0.0)
                .linear_gradient(std::f32::consts::PI, [(0.0, clear), (1.0, black)]),
        )
        .child(
            el().size(10.0, 10.0)
                .radius(5.0)
                .border(2.0, white)
                .absolute(sat * w - 5.0, (1.0 - val) * hgt - 5.0),
        )
        .on_drag(move |s: &mut SettingsState, d: &mut rune::Drag, _| {
            let hue = s.picker_hsv.0;
            apply_hsv(s, (hue, unit(d.x, d.w), 1.0 - unit(d.y, d.h)));
        });
    let strip = el()
        .key("picker-hue")
        .role("slider")
        .label("Hue")
        .size(w, 14.0)
        .radius(7.0)
        .linear_gradient(std::f32::consts::FRAC_PI_2, rainbow_stops())
        .child(
            el().size(6.0, 18.0)
                .radius(3.0)
                .border(2.0, white)
                .absolute(h * (w - 6.0), -2.0),
        )
        .on_drag(move |s: &mut SettingsState, d: &mut rune::Drag, _| {
            let (_, sat, val) = s.picker_hsv;
            apply_hsv(s, (unit(d.x, d.w), sat, val));
        });
    col().gap(8.0).child(square).child(strip)
}

fn choice_row<const N: usize>(
    k: &rune_kit::Kit,
    label: &str,
    options: &[&str; N],
    selected: Option<usize>,
    pick: impl Fn(&mut SettingsState, usize, &mut rune::Tx) + Clone + 'static,
) -> El {
    col()
        .w_full()
        .px(16.0)
        .py(10.0)
        .gap(8.0)
        .child(
            text(label)
                .font(k.ty.text_small)
                .color(k.c.text_base)
                .truncate(),
        )
        .child(accent_segments(k, label, options, selected, pick))
}

/// A full-width segmented control whose selected segment is filled with the accent.
fn accent_segments<const N: usize>(
    k: &rune_kit::Kit,
    label: &str,
    options: &[&str; N],
    selected: Option<usize>,
    pick: impl Fn(&mut SettingsState, usize, &mut rune::Tx) + Clone + 'static,
) -> El {
    let c = &k.c;
    let accent = c.bg_accent;
    let luma = 0.2126 * accent.r + 0.7152 * accent.g + 0.0722 * accent.b;
    let on_accent = if luma > 0.6 {
        rune::Color {
            r: 0.1,
            g: 0.1,
            b: 0.1,
            a: 1.0,
        }
    } else {
        rune::Color::WHITE
    };
    let font = rune::TextStyle {
        line_height: 13.0,
        ..k.ty.text_xsmall
    };
    let mut root = row()
        .role("radiogroup")
        .label(label)
        .focus_group()
        .w_full()
        .h(28.0)
        .center_y()
        .radius(6.0)
        .fill(c.layer_01)
        .box_shadow(rune::Shadow {
            spread: 0.5,
            color: c.border_base,
            ..Default::default()
        });
    for (i, name) in options.iter().enumerate() {
        let on = selected == Some(i);
        let pick = pick.clone();
        let mut seg = row()
            .key(format!("segment{i}"))
            .role("radio")
            .label(*name)
            .position_in_set(i + 1, N)
            .focusable(true)
            .focus_selected(on)
            .focus_ring(2.0, 1.0, c.border_focus)
            .grow(1.0)
            .shrink()
            .h(28.0)
            .px(12.0)
            .center()
            .radius(6.0)
            .child(
                text(*name)
                    .key("label")
                    .font(font)
                    .color(if on { on_accent } else { c.text_muted })
                    .truncate()
                    .a11y_hidden(),
            )
            .on_press_tx(move |s: &mut SettingsState, tx| pick(s, i, tx));
        if on {
            seg = seg.fill(accent);
        } else {
            seg = seg.hover(c.hover);
        }
        root = root.child(seg);
    }
    root
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "antimatter-settings-view-{name}-{}",
                uuid::Uuid::new_v4()
            ))
            .join(settings::FILE_NAME)
    }

    #[test]
    fn a_change_persists_and_reloads() {
        let path = temp_path("persist");
        let mut state = SettingsState::new(Settings::default(), Some(path.clone()), None);
        state.change(|p| p.message_font_size = 16);
        assert_eq!(state.error, None);
        assert_eq!(settings::load(&path).unwrap().message_font_size, 16);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_failed_write_restores_the_last_persisted_value() {
        let dir =
            std::env::temp_dir().join(format!("antimatter-settings-view-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // A directory where the file should be makes the atomic rename fail.
        let path = dir.join(settings::FILE_NAME);
        std::fs::create_dir_all(&path).unwrap();
        let mut state = SettingsState::new(Settings::default(), Some(path), None);
        state.change(|p| p.message_font_size = 18);
        assert_eq!(state.prefs.message_font_size, 12);
        assert!(state.error.is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_file_is_never_overwritten() {
        let path = temp_path("read-only");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{not json").unwrap();
        let mut state = SettingsState::new(
            Settings::default(),
            Some(path.clone()),
            Some("unreadable".into()),
        );
        assert!(state.read_only);
        state.change(|p| p.message_font_size = 20);
        assert_eq!(state.prefs.message_font_size, 12);
        assert_eq!(std::fs::read(&path).unwrap(), b"{not json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn account_actions_are_inert_without_a_workspace() {
        let state = SettingsState::new(Settings::default(), None, None);
        state.workspace_action(|_| panic!("no workspace is attached"));
    }
}
