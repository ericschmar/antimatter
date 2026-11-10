use antimatter_theme::Theme;
use rune_kit::Kit;
use std::sync::atomic::{AtomicU8, Ordering};

// ponytail: a process-wide selection read by the widget helpers, set once per frame from
// `State::theme`; ceiling is one theme per process. Upgrade: pass `&Kit` through the helpers.
static ACTIVE: AtomicU8 = AtomicU8::new(0);

pub(crate) fn select(theme: Theme) {
    ACTIVE.store(theme as u8, Ordering::Relaxed);
}

pub(crate) fn workspace_theme() -> Kit {
    Theme::ALL[ACTIVE.load(Ordering::Relaxed) as usize].kit()
}
