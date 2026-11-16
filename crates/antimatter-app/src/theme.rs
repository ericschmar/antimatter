use crate::settings::accent_rgb;
use antimatter_services::settings::AccentColor;
use antimatter_theme::Theme;
use rune::Color;
use rune_kit::Kit;
use std::sync::atomic::{AtomicU8, Ordering};

// ponytail: a process-wide selection read by the widget helpers, set once per frame from
// `State::theme`; ceiling is one theme per process. Upgrade: pass `&Kit` through the helpers.
static ACTIVE: AtomicU8 = AtomicU8::new(0);
static ACCENT: AtomicU8 = AtomicU8::new(0);

pub(crate) fn select(theme: Theme, accent: AccentColor) {
    ACTIVE.store(theme as u8, Ordering::Relaxed);
    ACCENT.store(accent as u8, Ordering::Relaxed);
}

pub(crate) fn workspace_theme() -> Kit {
    let mut kit = Theme::ALL[ACTIVE.load(Ordering::Relaxed) as usize].kit();
    let accent = match ACCENT.load(Ordering::Relaxed) {
        1 => AccentColor::Coral,
        2 => AccentColor::OceanBlue,
        3 => AccentColor::Fern,
        4 => AccentColor::Amber,
        5 => AccentColor::Violet,
        _ => return kit,
    };
    let (r, g, b) = accent_rgb(accent);
    let color = Color { r, g, b, a: 1.0 };
    kit.c.bg_accent = color;
    kit.c.text_accent = color;
    kit.c.icon_accent = color;
    kit.c.border_focus = color;
    kit
}
