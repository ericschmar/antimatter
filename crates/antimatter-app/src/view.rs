use crate::signin::application;
use crate::state::*;
use crate::theme::{select, workspace_theme};
use rune::{Cx, El, col, el, text, text_input};

pub(crate) fn view(s: &State, _: &mut Cx<State>) -> El {
    select(s.theme);
    let k = workspace_theme();
    let t = &k.c;
    if s.application {
        return application(s);
    }
    if s.auth_proof {
        return col()
            .w_full()
            .h_full()
            .padding(16.0)
            .gap(12.0)
            .fill(t.page)
            .child(
                text("Synthetic secure-input check")
                    .font(k.ty.ui)
                    .color(t.text_base),
            )
            .child(
                text_input(&s.pat, k.ty.ui)
                    .key("pat")
                    .label("Personal access token")
                    .single_line()
                    .w_full()
                    .h(40.0)
                    .on_edit(|s: &mut State| &mut s.pat),
            )
            .child(
                text_input(&s.password, k.ty.ui)
                    .key("password")
                    .label("Password")
                    .single_line()
                    .w_full()
                    .h(40.0)
                    .on_edit(|s: &mut State| &mut s.password),
            );
    }
    let label = text(if s.on { "Lights on" } else { "Lights off" })
        .font(k.ty.ui_medium)
        .color(t.text_base);
    let knob = el()
        .key("knob")
        .size(18.0, 18.0)
        .radius(9.0)
        .fill(t.knob)
        .absolute(if s.on { 18.0 } else { 2.0 }, 2.0);
    let switch = el()
        .key("switch")
        .role("switch")
        .label("Lights")
        .checked(s.on)
        .focusable(true)
        .size(38.0, 22.0)
        .radius(11.0)
        .fill(if s.on { t.bg_accent } else { t.layer_03 })
        .motion(k.motion.control)
        .on_press(|s: &mut State| s.on = !s.on)
        .child(knob);
    col()
        .w_full()
        .h_full()
        .center()
        .gap(16.0)
        .fill(t.page)
        .child(label)
        .child(switch)
}
