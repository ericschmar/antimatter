use crate::settings::accent_rgb;
use antimatter_services::settings::AccentColor;
use antimatter_theme::Theme;
use rune::{Color, TextStyle};
use rune_kit::Kit;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};

// ponytail: a process-wide selection read by the widget helpers, set once per frame from
// `State::theme`; ceiling is one theme per process. Upgrade: pass `&Kit` through the helpers.
static ACTIVE: AtomicU8 = AtomicU8::new(0);
static ACCENT: AtomicU32 = AtomicU32::new(0);

pub(crate) fn select(theme: Theme, accent: AccentColor) {
    ACTIVE.store(theme as u8, Ordering::Relaxed);
    ACCENT.store(encode(accent), Ordering::Relaxed);
}

/// The kit for context menus: the same tokens with a smaller menu-item font.
pub(crate) fn menu_theme(k: &Kit) -> Kit {
    let mut k = k.clone();
    k.ty.ui_compact = TextStyle {
        size: 12.0,
        line_height: 16.0,
        ..k.ty.ui_compact
    };
    k
}

pub(crate) fn workspace_theme() -> Kit {
    themed(ACCENT.load(Ordering::Relaxed))
}

/// The active theme with an explicit accent, for windows whose own preferences are fresher
/// than the last workspace frame.
pub(crate) fn with_accent(accent: AccentColor) -> Kit {
    themed(encode(accent))
}

/// Presets are their `ACCENTS` index; a custom colour is `0x0100_0000 | rgb`.
fn encode(accent: AccentColor) -> u32 {
    match accent {
        AccentColor::Custom(r, g, b) => 0x0100_0000 | (r as u32) << 16 | (g as u32) << 8 | b as u32,
        preset => crate::settings::ACCENTS
            .iter()
            .position(|a| *a == preset)
            .unwrap_or(0) as u32,
    }
}

fn decode(code: u32) -> AccentColor {
    if code & 0x0100_0000 != 0 {
        AccentColor::Custom((code >> 16) as u8, (code >> 8) as u8, code as u8)
    } else {
        crate::settings::ACCENTS
            .get(code as usize)
            .copied()
            .unwrap_or_default()
    }
}

fn themed(code: u32) -> Kit {
    let mut kit = Theme::ALL[ACTIVE.load(Ordering::Relaxed) as usize].kit();
    let accent = decode(code);
    let (r, g, b) = accent_rgb(accent);
    let color = Color { r, g, b, a: 1.0 };
    kit.c.bg_accent = color;
    kit.c.text_accent = color;
    kit.c.icon_accent = color;
    kit.c.border_focus = color;
    kit
}
