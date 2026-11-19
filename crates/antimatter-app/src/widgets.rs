use crate::state::*;
use crate::theme::workspace_theme;
use rune::{Color, El, TextEdit, TextStyle, Tx, el, row, text};
use rune_kit::{Button, ButtonVariant, Kit, Switch, TextInput};

/// A switch whose label sits at the left edge and whose track sits at the right, filling the row.
/// The kit's `Switch` draws the track and supplies the role and checked state; the whole row toggles,
/// so pressing the label works too, and the switch keeps its accessible name.
pub(crate) fn switch_row(
    key: &str,
    label: &str,
    checked: bool,
    on_toggle: impl Fn(&mut State) + 'static,
    k: &Kit,
) -> El {
    let switch = Switch::new(checked).label(label).hide_label().build(k);
    row()
        .key(key)
        .w_full()
        .pl(8.0)
        .center_y()
        .justify_between()
        .on_press(on_toggle)
        .child(
            text(label)
                .font(TextStyle {
                    line_height: 16.0,
                    ..k.ty.small
                })
                .color(k.c.text_faint)
                .a11y_hidden(),
        )
        .child(switch)
}

type Visual = rune_kit::State;

/// Equal segments over a layer with a sliding indicator. Mirrors `rune_kit::SegmentedControl`
/// (same geometry, states and motion) but takes the label type as a parameter, so a dense filter row
/// can use the caption size the kit's control hardcodes away. The indicator slides between segments
/// whenever the selection changes, in both fixed and filling widths; `accent` fills it with the accent
/// colour instead of the raised surface.
pub(crate) struct Segments {
    labels: Vec<String>,
    selected: Option<usize>,
    width: Option<f32>,
    font: Option<TextStyle>,
    accent: bool,
    states: Vec<Visual>,
    pick: Option<Pick>,
    label: Option<String>,
}

type Pick = Box<dyn Fn(usize) -> Box<dyn FnOnce(El) -> El>>;

impl Segments {
    pub(crate) fn new<S: AsRef<str>>(labels: &[S], selected: Option<usize>) -> Self {
        Self {
            labels: labels.iter().map(|l| l.as_ref().to_owned()).collect(),
            selected,
            width: Some(232.0),
            font: None,
            accent: false,
            states: Vec::new(),
            pick: None,
            label: None,
        }
    }
    pub(crate) fn label(mut self, l: impl Into<String>) -> Self {
        self.label = Some(l.into());
        self
    }
    /// Width in points; `None` fills the parent.
    pub(crate) fn width(mut self, w: Option<f32>) -> Self {
        self.width = w;
        self
    }
    pub(crate) fn accent(mut self) -> Self {
        self.accent = true;
        self
    }
    /// The segment label type; defaults to the kit's `ui` style at its 13 point line.
    pub(crate) fn font(mut self, style: TextStyle) -> Self {
        self.font = Some(style);
        self
    }
    pub(crate) fn on_pick<S: 'static>(
        mut self,
        f: impl Fn(&mut S, usize, &mut Tx) + Clone + 'static,
    ) -> Self {
        self.pick = Some(Box::new(move |i| {
            let f = f.clone();
            Box::new(move |e: El| e.on_press_tx(move |s: &mut S, tx: &mut Tx| f(s, i, tx)))
        }));
        self
    }

    pub(crate) fn build(self, k: &Kit) -> El {
        let c = &k.c;
        let n = self.labels.len().max(1);
        let font = self.font.unwrap_or(TextStyle {
            line_height: 13.0,
            ..k.ty.ui
        });
        let mut root = row()
            .role("radiogroup")
            .focus_group()
            .h(28.0)
            .center_y()
            .radius(6.0)
            .fill(c.layer_01)
            .box_shadow(rune::Shadow {
                spread: 0.5,
                color: c.border_base,
                ..Default::default()
            });
        if let Some(l) = self.label {
            root = root.label(l);
        }
        root = match self.width {
            Some(w) => root.w(w),
            None => root.w_full().equal_columns(n),
        };
        let indicator = || {
            el().key("indicator")
                .h(28.0)
                .radius(6.0)
                .fill(if self.accent { c.bg_accent } else { c.bg_base })
                .box_shadow(rune::Shadow {
                    spread: 0.5,
                    color: c.border_strong,
                    ..Default::default()
                })
                .token_motion(k.motion.control)
                .a11y_hidden()
        };
        match (self.selected, self.width) {
            (Some(sel), Some(w)) => {
                let seg = w / n as f32;
                root = root.child(indicator().w(seg).absolute(seg * sel as f32, 0.0));
            }
            (Some(sel), None) => root = root.child(indicator().grid_cell(sel)),
            _ => {}
        }
        for (i, l) in self.labels.into_iter().enumerate() {
            let st = self.states.get(i).copied().unwrap_or_default();
            let on = self.selected == Some(i);
            let ink = if on && self.accent {
                accent_ink(c.bg_accent)
            } else if on || st == Visual::Hover {
                c.text_base
            } else {
                c.text_muted
            };
            let hovers = st == Visual::Rest && !on && self.pick.is_some();
            let mut label = text(l.clone())
                .key("label")
                .font(font)
                .color(ink)
                .truncate()
                .a11y_hidden();
            if hovers {
                label = label.group_color(c.text_base);
            }
            let mut seg = row()
                .key(format!("segment{i}"))
                .role("radio")
                .focusable(st != Visual::Disabled)
                .focus_selected(on)
                .focus_ring(2.0, 1.0, c.border_focus)
                .disabled(st == Visual::Disabled)
                .label(l.clone())
                .position_in_set(i + 1, n)
                .grow(1.0)
                .shrink()
                .h(28.0)
                .px(12.0)
                .center()
                .radius(6.0)
                .child(label);
            if self.width.is_none() {
                seg = seg.grid_cell(i);
            }
            match st {
                Visual::Focus => seg = seg.outline(2.0, 1.0, c.border_focus),
                Visual::Disabled => seg = seg.layer_opacity(0.45),
                Visual::Hover if !on => seg = seg.fill(c.hover),
                _ => {}
            }
            if hovers {
                seg = seg.hover(c.hover).press(press_over(c.hover, c.pressed));
            }
            if st != Visual::Disabled
                && let Some(p) = &self.pick
            {
                seg = p(i)(seg);
            }
            root = root.child(seg);
        }
        root
    }
}

/// Dark ink on a light accent, white on a dark one.
fn accent_ink(accent: Color) -> Color {
    let luma = 0.2126 * accent.r + 0.7152 * accent.g + 0.0722 * accent.b;
    if luma > 0.6 {
        Color {
            r: 0.1,
            g: 0.1,
            b: 0.1,
            a: 1.0,
        }
    } else {
        Color::WHITE
    }
}

/// The pressed overlay over a hovered segment, as the kit composites it.
fn press_over(hover: Color, pressed: Color) -> Color {
    if hover.a >= 0.999 {
        return pressed;
    }
    let a = ((pressed.a - hover.a) / (1.0 - hover.a)).clamp(0.0, 1.0);
    pressed.alpha(a)
}

pub(crate) fn button(
    key: &str,
    label: &str,
    disabled: bool,
    action: impl Fn(&mut State) + Send + Sync + 'static,
) -> El {
    button_as(ButtonVariant::Outline, key, label, disabled, action)
}

pub(crate) fn button_as(
    variant: ButtonVariant,
    key: &str,
    label: &str,
    disabled: bool,
    action: impl Fn(&mut State) + Send + Sync + 'static,
) -> El {
    let control = Button::new(label)
        .variant(variant)
        .disabled(disabled)
        .on_press(move |s: &mut State| {
            if !disabled {
                action(s);
            }
        })
        .build(&workspace_theme())
        .key(key);
    if disabled { control.inert() } else { control }
}

pub(crate) fn field(
    edit: &TextEdit,
    key: &str,
    label: &str,
    on_edit: fn(&mut State) -> &mut TextEdit,
    on_submit: fn(&mut State),
) -> El {
    TextInput::new(edit)
        .label(label)
        .placeholder(label)
        .width(None)
        .height(36.0)
        .on_edit(on_edit)
        .on_submit(move |s: &mut State, _| on_submit(s))
        .build(&workspace_theme())
        .key(key)
}

pub(crate) fn section(label: &str, k: &Kit) -> El {
    text(label)
        .font(k.ty.small_medium)
        .color(k.c.text_muted)
        .wrap()
        .mt(6.0)
}
