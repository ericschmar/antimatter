use antimatter_services::settings::{
    AccentColor, AppFontFamily, MessageSpacing, Settings, ThemePreference,
};

/// Sidebar order matches the Swift Settings window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Section {
    General,
    Appearance,
    Notifications,
    Workspace,
    KeyboardShortcuts,
    Profile,
    Accounts,
}

impl Section {
    pub(crate) const ALL: [Section; 7] = [
        Section::General,
        Section::Appearance,
        Section::Notifications,
        Section::Workspace,
        Section::KeyboardShortcuts,
        Section::Profile,
        Section::Accounts,
    ];

    pub(crate) fn title(self) -> &'static str {
        match self {
            Section::General => "General",
            Section::Appearance => "Appearance",
            Section::Notifications => "Notifications",
            Section::Workspace => "Workspace",
            Section::KeyboardShortcuts => "Keyboard Shortcuts",
            Section::Profile => "Profile",
            Section::Accounts => "Accounts",
        }
    }

    pub(crate) fn subtitle(self) -> &'static str {
        match self {
            Section::General => "Set up the essentials for your Antimatter workspace.",
            Section::Appearance => "Control the density and visual treatment of your timeline.",
            Section::Notifications => {
                "Control local delivery and Mattermost preferences for this account."
            }
            Section::Workspace => "Choose how conversations open in your workspace.",
            Section::KeyboardShortcuts => "Use these shortcuts to move quickly around Antimatter.",
            Section::Profile => "Manage the identity visible to people in this Mattermost server.",
            Section::Accounts => {
                "Switch between signed-in Mattermost servers or add another account."
            }
        }
    }
}

pub(crate) const SHORTCUTS: [(&str, &str); 8] = [
    ("Open command palette", "⌘K"),
    ("Close active chat", "⌘W"),
    ("Previous chat tab", "⌘["),
    ("Next chat tab", "⌘]"),
    ("Focus sidebar", "⌥⌘1"),
    ("Focus conversation", "⌥⌘2"),
    ("New workspace window", "⇧⌘N"),
    ("Open settings", "⌘,"),
];

pub(crate) const ACCENTS: [AccentColor; 6] = [
    AccentColor::Onyx,
    AccentColor::Coral,
    AccentColor::OceanBlue,
    AccentColor::Fern,
    AccentColor::Amber,
    AccentColor::Violet,
];

pub(crate) fn accent_name(accent: AccentColor) -> &'static str {
    match accent {
        AccentColor::Onyx => "Onyx",
        AccentColor::Coral => "Coral",
        AccentColor::OceanBlue => "Ocean Blue",
        AccentColor::Fern => "Fern",
        AccentColor::Amber => "Amber",
        AccentColor::Violet => "Violet",
    }
}

/// The accent's sRGB anchor, as the Swift `AccentColor.color` values.
pub(crate) fn accent_rgb(accent: AccentColor) -> (f32, f32, f32) {
    match accent {
        AccentColor::Onyx => (0.13, 0.13, 0.14),
        AccentColor::Coral => (0.90, 0.22, 0.27),
        AccentColor::OceanBlue => (0.00, 0.48, 1.00),
        AccentColor::Fern => (0.20, 0.70, 0.42),
        AccentColor::Amber => (0.98, 0.62, 0.11),
        AccentColor::Violet => (0.60, 0.35, 0.85),
    }
}

pub(crate) const FONTS: [AppFontFamily; 4] = [
    AppFontFamily::System,
    AppFontFamily::Rounded,
    AppFontFamily::Serif,
    AppFontFamily::Monospaced,
];

pub(crate) fn font_name(family: AppFontFamily) -> &'static str {
    match family {
        AppFontFamily::System => "System",
        AppFontFamily::Rounded => "Rounded",
        AppFontFamily::Serif => "Serif",
        AppFontFamily::Monospaced => "Monospaced",
    }
}

pub(crate) const SPACINGS: [MessageSpacing; 3] = [
    MessageSpacing::Small,
    MessageSpacing::Medium,
    MessageSpacing::Large,
];

pub(crate) fn spacing_name(spacing: MessageSpacing) -> &'static str {
    match spacing {
        MessageSpacing::Small => "Small",
        MessageSpacing::Medium => "Medium",
        MessageSpacing::Large => "Large",
    }
}

pub(crate) const THEMES: [ThemePreference; 3] = [
    ThemePreference::Light,
    ThemePreference::Dark,
    ThemePreference::System,
];

pub(crate) fn theme_name(theme: ThemePreference) -> &'static str {
    match theme {
        ThemePreference::Light => "Light",
        ThemePreference::Dark => "Dark",
        ThemePreference::System => "System",
    }
}

/// Value row text for the grouping stepper: `Off` at zero, else whole minutes.
pub(crate) fn grouping_label(minutes: u8) -> String {
    if minutes == 0 {
        "Off".into()
    } else {
        format!("{minutes} min")
    }
}

pub(crate) fn font_size_label(points: u8) -> String {
    format!("{points} pt")
}

/// Clamps a stepper move to the Swift ranges: font size 10...20, grouping 0...60.
pub(crate) fn step_font_size(settings: &mut Settings, delta: i8) {
    settings.message_font_size = settings
        .message_font_size
        .saturating_add_signed(delta)
        .clamp(10, 20);
}

pub(crate) fn step_grouping(settings: &mut Settings, delta: i8) {
    settings.message_grouping_interval_minutes = settings
        .message_grouping_interval_minutes
        .saturating_add_signed(delta)
        .clamp(0, 60);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_follow_the_swift_order_and_titles() {
        let titles: Vec<_> = Section::ALL.iter().map(|s| s.title()).collect();
        assert_eq!(
            titles,
            [
                "General",
                "Appearance",
                "Notifications",
                "Workspace",
                "Keyboard Shortcuts",
                "Profile",
                "Accounts",
            ]
        );
    }

    #[test]
    fn accent_anchors_match_the_swift_rgb_values() {
        assert_eq!(accent_rgb(AccentColor::OceanBlue), (0.00, 0.48, 1.00));
        assert_eq!(accent_rgb(AccentColor::Violet), (0.60, 0.35, 0.85));
        assert_eq!(accent_name(AccentColor::OceanBlue), "Ocean Blue");
    }

    #[test]
    fn steppers_stay_inside_swift_ranges() {
        let mut settings = Settings::default();
        for _ in 0..20 {
            step_font_size(&mut settings, 1);
        }
        assert_eq!(settings.message_font_size, 20);
        for _ in 0..20 {
            step_font_size(&mut settings, -1);
        }
        assert_eq!(settings.message_font_size, 10);
        for _ in 0..80 {
            step_grouping(&mut settings, 1);
        }
        assert_eq!(settings.message_grouping_interval_minutes, 60);
        for _ in 0..80 {
            step_grouping(&mut settings, -1);
        }
        assert_eq!(settings.message_grouping_interval_minutes, 0);
    }

    #[test]
    fn grouping_reads_off_at_zero_and_minutes_otherwise() {
        assert_eq!(grouping_label(0), "Off");
        assert_eq!(grouping_label(5), "5 min");
        assert_eq!(font_size_label(12), "12 pt");
    }

    #[test]
    fn shortcut_reference_lists_every_documented_binding() {
        assert_eq!(SHORTCUTS.len(), 8);
        assert_eq!(SHORTCUTS[7], ("Open settings", "⌘,"));
    }
}
