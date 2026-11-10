use crate::state::*;
use crate::theme::workspace_theme;
use rune::{El, TextEdit, text};
use rune_kit::{Button, ButtonVariant, Kit, TextInput};

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
) -> El {
    TextInput::new(edit)
        .label(label)
        .placeholder(label)
        .width(None)
        .height(36.0)
        .on_edit(on_edit)
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
