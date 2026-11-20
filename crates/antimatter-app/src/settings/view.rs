use super::model::*;
use super::pages::page;
use crate::workspace::TITLEBAR;
use antimatter_services::settings::{self, Settings};
use rune::{El, col, el, row, text};
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
    /// The signed-in user, whose name colour the picker edits when it is not the accent.
    pub(crate) me: Option<String>,
    pub(crate) name_picker_open: bool,
    /// Outcome of the last manual "Check for updates" press, shown under the General section.
    pub(crate) update_check: Option<String>,
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
            me: None,
            name_picker_open: false,
            update_check: None,
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
        let composer_font_size = self.prefs.composer_font_size;
        let composer_font_family = self.prefs.composer_font_family;
        let app_font_family = self.prefs.app_font_family;
        let message_spacing = self.prefs.timeline_message_spacing;
        let show_timeline_avatars = self.prefs.show_timeline_avatars;
        let avatar_size = self.prefs.timeline_avatar_size;
        let accent = self.prefs.accent_color;
        let notify = (
            self.prefs.notifications_enabled,
            self.prefs.notification_sounds_enabled,
        );
        let theme = theme_for(self.prefs.theme);
        let name_colors = self.prefs.name_colors.clone();
        self.workspace_action(move |ws| {
            ws.accent = accent;
            ws.notifications_enabled = notify.0;
            ws.notification_sounds_enabled = notify.1;
            ws.name_colors = name_colors;
            ws.theme = theme;
            ws.message_font_size = message_font_size;
            ws.composer_font_size = composer_font_size;
            ws.composer_font_family = composer_font_family;
            ws.app_font_family = app_font_family;
            ws.message_spacing = message_spacing;
            ws.show_timeline_avatars = show_timeline_avatars;
            ws.avatar_size = avatar_size;
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
    let k = crate::theme::with_accent(s.prefs.accent_color, s.prefs.app_font_family);
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
