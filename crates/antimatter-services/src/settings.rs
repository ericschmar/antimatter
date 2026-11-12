use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

const VERSION: u32 = 1;
pub const FILE_NAME: &str = "settings.json";

#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    Json(serde_json::Error),
    UnsupportedVersion(u32),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(_) => f.write_str("settings storage I/O failure"),
            Self::Json(_) => f.write_str("settings file is not valid"),
            Self::UnsupportedVersion(version) => {
                write!(f, "settings file version {version} is not supported")
            }
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccentColor {
    Onyx,
    Coral,
    #[default]
    OceanBlue,
    Fern,
    Amber,
    Violet,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppFontFamily {
    #[default]
    System,
    Rounded,
    Serif,
    Monospaced,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageSpacing {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default, rename_all = "camelCase")]
pub struct Settings {
    pub message_font_size: u8,
    pub message_grouping_interval_minutes: u8,
    pub accent_color: AccentColor,
    pub app_font_family: AppFontFamily,
    pub theme: ThemePreference,
    pub compact_timeline: bool,
    pub timeline_message_spacing: MessageSpacing,
    pub show_timeline_avatars: bool,
    pub notifications_enabled: bool,
    pub notification_sounds_enabled: bool,
    pub workspace_open_previews: bool,
    pub automatically_open_direct_messages_in_new_window: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            message_font_size: 12,
            message_grouping_interval_minutes: 5,
            accent_color: AccentColor::default(),
            app_font_family: AppFontFamily::default(),
            theme: ThemePreference::default(),
            compact_timeline: true,
            timeline_message_spacing: MessageSpacing::default(),
            show_timeline_avatars: true,
            notifications_enabled: true,
            notification_sounds_enabled: true,
            workspace_open_previews: true,
            automatically_open_direct_messages_in_new_window: false,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    settings: Settings,
}

/// Reads `settings.json`. A missing file yields defaults. A file that cannot be read,
/// parsed or versioned for this build is an error; the caller keeps defaults for display
/// and must not overwrite the file.
pub fn load(path: &Path) -> Result<Settings> {
    match fs::read(path) {
        Ok(bytes) => {
            let record: Record = serde_json::from_slice(&bytes).map_err(Error::Json)?;
            if record.version != VERSION {
                return Err(Error::UnsupportedVersion(record.version));
            }
            Ok(record.settings)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(Error::Io(error)),
    }
}

/// Writes `settings.json` atomically: a temporary sibling is synced and renamed over the
/// target, so readers see the old or the new file, never a partial one.
pub fn save(path: &Path, settings: &Settings) -> Result<()> {
    let bytes = serde_json::to_vec(&Record {
        version: VERSION,
        settings: settings.clone(),
    })
    .map_err(Error::Json)?;
    let parent = path
        .parent()
        .ok_or_else(|| Error::Io(io::Error::other("missing settings directory")))?;
    fs::create_dir_all(parent).map_err(Error::Io)?;
    let temp = parent.join(format!(".{FILE_NAME}.tmp"));
    let result = (|| {
        use std::io::Write;
        let mut file = fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        fs::File::open(parent)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(Error::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "antimatter-settings-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn defaults_match_the_swift_settings_window() {
        let defaults = Settings::default();
        assert_eq!(defaults.message_font_size, 12);
        assert_eq!(defaults.message_grouping_interval_minutes, 5);
        assert_eq!(defaults.accent_color, AccentColor::OceanBlue);
        assert_eq!(defaults.app_font_family, AppFontFamily::System);
        assert_eq!(defaults.theme, ThemePreference::System);
        assert!(defaults.compact_timeline && defaults.show_timeline_avatars);
        assert_eq!(defaults.timeline_message_spacing, MessageSpacing::Medium);
        assert!(defaults.notifications_enabled && defaults.notification_sounds_enabled);
        assert!(defaults.workspace_open_previews);
        assert!(!defaults.automatically_open_direct_messages_in_new_window);
    }

    #[test]
    fn missing_file_loads_defaults_and_round_trips() {
        let dir = root("round-trip");
        let path = dir.join(FILE_NAME);
        assert_eq!(load(&path).unwrap(), Settings::default());
        let changed = Settings {
            message_font_size: 18,
            accent_color: AccentColor::Violet,
            theme: ThemePreference::Light,
            timeline_message_spacing: MessageSpacing::Large,
            notifications_enabled: false,
            ..Settings::default()
        };
        save(&path, &changed).unwrap();
        assert_eq!(load(&path).unwrap(), changed);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_keys_take_defaults() {
        let dir = root("missing-keys");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        fs::write(&path, br#"{"version":1,"settings":{"messageFontSize":15}}"#).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.message_font_size, 15);
        assert_eq!(loaded.message_grouping_interval_minutes, 5);
        assert!(loaded.compact_timeline);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_or_unknown_version_fails_closed_without_overwrite() {
        let dir = root("fail-closed");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        for bytes in [
            &b"{not json"[..],
            br#"{"version":2,"settings":{"messageFontSize":15}}"#,
            br#"{"version":1,"settings":{},"unknownKey":true}"#,
            br#"{"version":1,"settings":{"unknownSetting":true}}"#,
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(load(&path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn accent_and_spacing_values_use_the_documented_names() {
        assert_eq!(
            serde_json::to_string(&AccentColor::OceanBlue).unwrap(),
            "\"oceanBlue\""
        );
        assert_eq!(
            serde_json::to_string(&MessageSpacing::Medium).unwrap(),
            "\"medium\""
        );
        assert_eq!(
            serde_json::to_string(&AppFontFamily::Monospaced).unwrap(),
            "\"monospaced\""
        );
        assert_eq!(
            serde_json::to_string(&ThemePreference::Dark).unwrap(),
            "\"dark\""
        );
    }
}
