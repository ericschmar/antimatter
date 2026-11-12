use super::model::*;
use crate::theme::workspace_theme;
use crate::workspace::TITLEBAR;
use antimatter_services::settings::{self, Settings};
use rune::{El, col, el, row, text};
use rune_kit::{Button, ButtonVariant, SegmentedControl, Switch};
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
    }
}

pub(crate) fn settings_view(s: &SettingsState, _: &mut rune::Cx<SettingsState>) -> El {
    let k = workspace_theme();
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
            .child(page(s, &k)),
    );
    row()
        .w_full()
        .h_full()
        .fill(c.bg_base)
        .child(sidebar)
        .child(detail.max_w(520.0))
}

fn page(s: &SettingsState, k: &rune_kit::Kit) -> El {
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
                    el()
                        .key(format!("accent-{accent:?}"))
                        .role("button")
                        .label(accent_name(accent))
                        .checked(s.prefs.accent_color == accent)
                        .focusable(true)
                        .size(24.0, 24.0)
                        .radius(12.0)
                        .fill(rune::Color { r, g, b, a: 1.0 })
                        .on_press(move |s: &mut SettingsState| {
                            s.change(|p| p.accent_color = accent)
                        }),
                );
            }
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
                        row_frame(k, "Accent color").child(swatches),
                        choice_row(
                            k,
                            "Font",
                            &FONTS.map(font_name),
                            font_index,
                            |s, i, _| s.change(|p| p.app_font_family = FONTS[i]),
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
            .child(deferred_group(
                k,
                "Mattermost preferences",
                &[
                    "Desktop notifications",
                    "Email notifications",
                    "Push notifications",
                    "Mention notifications",
                    "Thread reply notifications",
                ],
            ))
            .child(deferred_group(k, "Channel notification levels", &[]))
            .child(text(
                "Channel levels appear once this account has joined channels. Server writes are deferred.",
            )
            .font(k.ty.small)
            .color(c.text_muted)
            .wrap()),
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
        Section::Profile => deferred_group(
            k,
            "Profile",
            &[
                "Choose photo",
                "First name",
                "Last name",
                "Nickname",
                "Username",
                "Email",
                "Status",
                "Custom status",
            ],
        ),
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
            col()
                .w_full()
                .gap(14.0)
                .child(group(k, vec![card]))
                .child(
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
        .child(
            SegmentedControl::new(options, selected)
                .label(label)
                .width(None)
                .on_pick(pick)
                .build(k),
        )
}

fn deferred_group(k: &rune_kit::Kit, heading: &str, rows: &[&str]) -> El {
    let mut card = col().w_full().gap(10.0).child(
        text(heading)
            .font(k.ty.small_medium)
            .color(k.c.text_muted)
            .wrap(),
    );
    for label in rows {
        card = card.child(
            row_frame(k, label)
                .child(text("Deferred").font(k.ty.text_small).color(k.c.text_muted))
                .inert(),
        );
    }
    card
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
