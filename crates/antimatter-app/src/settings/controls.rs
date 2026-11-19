use super::model::*;
use super::view::*;
use antimatter_services::settings;
use rune::{El, col, el, row, text};
use rune_kit::{Button, ButtonVariant, Switch};

pub(super) fn group(k: &rune_kit::Kit, rows: Vec<El>) -> El {
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

pub(super) fn row_frame(k: &rune_kit::Kit, label: &str) -> El {
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

pub(super) fn toggle_row(
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

pub(super) fn stepper_row(
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
pub(super) fn hue_wheel(size: f32) -> rune::Shape {
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

pub(super) fn rainbow_stops() -> Vec<(f32, rune::Color)> {
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

pub(super) fn apply_hsv(s: &mut SettingsState, hsv: (f32, f32, f32)) {
    s.picker_hsv = hsv;
    let (r, g, b) = hsv_to_rgb(hsv.0, hsv.1, hsv.2);
    // ponytail: every drag step persists settings.json; upgrade is saving on pointer-up only.
    if s.name_picker_open {
        if let Some(me) = s.me.clone() {
            let hex = crate::name_colors::format((r, g, b));
            s.change(|p| {
                p.name_colors.insert(me, hex);
            });
        }
    } else {
        s.change(|p| p.accent_color = settings::AccentColor::Custom(r, g, b));
    }
}

/// A saturation/value square over the chosen hue, and a hue strip.
pub(super) fn color_picker(s: &SettingsState) -> El {
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

pub(super) fn choice_row<const N: usize>(
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
            crate::widgets::Segments::new(options, selected)
                .label(label)
                .width(None)
                .accent()
                .font(k.ty.text_xsmall)
                .on_pick(pick)
                .build(k),
        )
}
