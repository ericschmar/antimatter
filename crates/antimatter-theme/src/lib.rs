//! Antimatter-owned design tokens, expressed as a `rune_kit::Kit`.
//!
//! Semantic names follow `docs/swiftui-recreation/appendix/design-tokens.md`. Every kit field
//! is set here; nothing is inherited from `Kit::neutral` or `Kit::from_palette`.

use rune::{Color, Shadow, Spring, TextStyle, color::hex};
use rune_kit::{Elevation, Kit, Motion, Palette, Radius, StateColors, Type, glyphs};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Theme {
    #[default]
    Default,
    Light,
    HighContrast,
    Warm,
}

impl Theme {
    pub const ALL: [Theme; 4] = [
        Theme::Default,
        Theme::Light,
        Theme::HighContrast,
        Theme::Warm,
    ];

    pub fn kit(self) -> Kit {
        build(self.tokens(), !matches!(self, Theme::Light))
    }

    fn tokens(self) -> Tokens {
        let t = |a: [&str; 12]| Tokens {
            bg: c(a[0]),
            panel: c(a[1]),
            raised: c(a[2]),
            hover: c(a[3]),
            border: c(a[4]),
            border_strong: c(a[5]),
            text: c(a[6]),
            text_secondary: c(a[7]),
            text_muted: c(a[8]),
            accent: c(a[9]),
            warm: c(a[10]),
            danger: c(a[11]),
        };
        match self {
            Theme::Default => t([
                "#111113", "#18191b", "#212225", "#272a2d", "#363a3f", "#43484e", "#edeef0",
                "#b0b4ba", "#777b84", "#46a758", "#ffc53d", "#ff9592",
            ]),
            Theme::Light => t([
                "#f8fafc", "#ffffff", "#eef3f8", "#e2eaf3", "#d3dce7", "#aebccd", "#101827",
                "#334155", "#64748b", "#278747", "#b87503", "#a11c24",
            ]),
            // ponytail: high-contrast and warm values beyond the documented anchors (near-black
            // base, #ffffff text, #171512 base) are proposals pending design review.
            Theme::HighContrast => t([
                "#000000", "#0a0a0a", "#1a1a1a", "#2a2a2a", "#8a8a8a", "#d0d0d0", "#ffffff",
                "#f0f0f0", "#b8b8b8", "#5fd37a", "#ffd25e", "#ffb3b0",
            ]),
            Theme::Warm => t([
                "#171512", "#1e1b17", "#28241e", "#322d25", "#463f34", "#5a5143", "#f3e7cf",
                "#c9bca3", "#8f8470", "#e8913a", "#ffc53d", "#ff9592",
            ]),
        }
    }
}

fn c(s: &str) -> Color {
    hex(s).expect("valid theme color")
}

struct Tokens {
    bg: Color,
    panel: Color,
    raised: Color,
    hover: Color,
    border: Color,
    border_strong: Color,
    text: Color,
    text_secondary: Color,
    text_muted: Color,
    accent: Color,
    warm: Color,
    danger: Color,
}

fn build(t: Tokens, dark: bool) -> Kit {
    let (white, black) = (Color::WHITE, Color::BLACK);
    let state = |fg: Color| StateColors {
        bg: t.panel.mix(fg, 0.12),
        fg,
        border: t.panel.mix(fg, 0.35),
        icon: fg,
    };
    let info = if dark { c("#70b8ff") } else { c("#0d74ce") };
    let step = t.hover.mix(t.border, 0.3);
    let ink = if dark { black } else { white };
    let c = Palette {
        page: t.bg,
        bg_base: t.bg,
        bg_deep: t.bg,
        layer_01: t.panel,
        layer_02: t.raised,
        layer_03: t.hover,
        layer_04: step,
        bg_inverse: t.text,
        bg_contrast: t.text,
        bg_button_neutral: t.panel,
        bg_icon_button_contrast: t.text,
        bg_accent: t.accent,
        submit_highlight: white.alpha(0.2),
        submit_hover: t.bg.alpha(0.12),
        submit_fg: t.bg,
        submit_icon: t.bg,
        text_base: t.text,
        text_muted: t.text_secondary,
        text_faint: t.text_muted,
        text_inverse: t.bg,
        text_contrast: t.bg,
        text_accent: t.accent,
        icon_base: t.text,
        icon_muted: t.text_secondary,
        icon_faint: t.text_muted,
        icon_inverse: t.bg,
        icon_contrast: t.bg,
        icon_accent: t.accent,
        border_muted: t.border.mix(t.bg, 0.5),
        border_base: t.border,
        border_strong: t.border_strong,
        border_focus: t.accent,
        hover: t.hover,
        pressed: step,
        contrast_hover: t.bg.alpha(0.10),
        contrast_pressed: t.bg.alpha(0.20),
        scrim: black.alpha(0.30),
        depth_top: white,
        depth_bottom: white.alpha(0.0),
        white,
        black,
        knob: t.text,
        knob_on: t.text,
        success: state(t.accent),
        warning: state(t.warm),
        danger: state(t.danger),
        info: state(info),
        surface_base: t.raised,
        surface_weak: t.panel,
        surface_hover: t.hover,
        surface_raised: t.panel,
        surface_raised_base: t.panel,
        surface_raised_hover: t.hover,
        surface_float: t.text,
        surface_disabled: t.raised,
        border_weak: t.border.mix(t.bg, 0.5),
        border_hover: t.border_strong,
        border_active: t.border_strong,
        border_disabled: t.border.mix(t.bg, 0.5),
        text_strong: t.text,
        text_weak: t.text_secondary,
        text_invert_strong: t.bg,
        icon_weaker: t.text_muted,
        std_border: t.border,
        std_icon: t.text_secondary,
        std_icon_invert: t.bg,
        std_icon_strong: t.text,
        std_text: t.text,
    };
    let ring = Shadow {
        spread: 0.5,
        color: t.border,
        ..Shadow::default()
    };
    let drop = |y: f32, blur: f32| Shadow {
        y,
        blur,
        color: ink.alpha(if dark { 0.30 } else { 0.12 }),
        ..Shadow::default()
    };
    let mut elevation = Elevation::default();
    elevation.raised = vec![drop(1.0, 2.0), ring];
    elevation.floating = vec![drop(4.0, 8.0), ring];
    elevation.overlay = vec![drop(8.0, 16.0), ring];
    elevation.button_neutral = vec![ring];
    elevation.md = vec![drop(4.0, 8.0)];
    elevation.knob = vec![drop(1.0, 3.0)];

    let ui = TextStyle::new(14.0, 400.0).lh(20.0);
    let snap = Spring::new(0.25, 0.0);
    Kit {
        dark,
        c,
        elevation,
        glyph: glyphs::DEFAULT,
        ty: Type {
            ui,
            ui_medium: TextStyle {
                weight: 600.0,
                ..ui
            },
            ui_compact: ui.lh(16.0),
            small: TextStyle::new(11.0, 400.0).lh(12.0),
            small_medium: TextStyle::new(11.0, 600.0).lh(12.0),
            body: TextStyle::new(14.0, 400.0).lh(21.0),
            body_medium: TextStyle::new(14.0, 600.0).lh(21.0),
            text_small: TextStyle::new(12.0, 400.0).lh(18.0),
            text_small_medium: TextStyle::new(12.0, 600.0).lh(18.0),
            text_xsmall: TextStyle::new(11.0, 400.0).lh(16.0),
            text_xsmall_medium: TextStyle::new(11.0, 600.0).lh(16.0),
            mono: TextStyle::new(12.0, 400.0).mono().lh(18.0),
        },
        radius: Radius {
            xs: 4.0,
            sm: 4.0,
            md: 6.0,
            lg: 8.0,
            xl: 8.0,
        },
        motion: Motion {
            control: snap,
            overlay: snap,
            disclosure: Spring::new(0.3, 0.0),
        },
        blend_over: None,
        ring: None,
        invalid_text: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contrast(a: Color, b: Color) -> f32 {
        let (a, b) = (a.luminance(), b.luminance());
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    #[test]
    fn every_theme_keeps_text_readable_and_documents_default_tokens() {
        for theme in Theme::ALL {
            let k = theme.kit();
            assert!(contrast(k.c.page, k.c.text_base) >= 7.0, "{theme:?} text");
            assert!(
                contrast(k.c.page, k.c.text_muted) >= 4.5,
                "{theme:?} secondary"
            );
            assert!(
                contrast(k.c.layer_01, k.c.text_faint) >= 3.0,
                "{theme:?} muted"
            );
            assert!(
                contrast(k.c.page, k.c.border_strong) >= 1.5,
                "{theme:?} border"
            );
        }
        let k = Theme::Default.kit();
        assert_eq!(k.c.page.hex(), c("#111113").hex());
        assert_eq!(k.c.layer_01.hex(), c("#18191b").hex());
        assert!(!Theme::Light.kit().dark);
    }
}
