use crate::state::*;
use crate::theme::workspace_theme;
use antimatter_theme::icons;
use rune::{
    Block, Color, El, Icon, Mark, RichStyle, Span, TextEdit, TextStyle, el, row, text_input,
};
use rune_kit::syntax::{SyntaxTheme, highlight};
use rune_kit::{Button, ButtonVariant, ControlSize, IconButton, IconButtonVariant, Kit};

fn code_spans(edit: &TextEdit, theme: &SyntaxTheme) -> Vec<Span> {
    let mut out = Vec::new();
    let paras = edit.paragraphs();
    let mut i = 0;
    while i < paras.len() {
        if paras[i].block == Block::Code {
            let start = paras[i].range.start;
            let mut end = paras[i].range.end;
            while i + 1 < paras.len() && paras[i + 1].block == Block::Code {
                i += 1;
                end = paras[i].range.end;
            }
            if let Some(code) = edit.text.get(start..end) {
                out.extend(theme.spans(&highlight(None, code), start));
            }
        }
        i += 1;
    }
    out
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Pane {
    Main,
    Thread,
}

impl Pane {
    fn prefix(self) -> &'static str {
        match self {
            Pane::Main => "",
            Pane::Thread => "thread-",
        }
    }

    fn edit(self, s: &State) -> &TextEdit {
        match self {
            Pane::Main => &s.draft,
            Pane::Thread => &s.thread_draft,
        }
    }

    fn access(self) -> fn(&mut State) -> &mut TextEdit {
        match self {
            Pane::Main => |s| &mut s.draft,
            Pane::Thread => |s| &mut s.thread_draft,
        }
    }
}

fn bar_icon(
    (k, pane): (&Kit, Pane),
    key: &str,
    icon: &'static Icon,
    label: &str,
    active: bool,
    locked: bool,
    on_press: impl Fn(&mut State) + 'static,
) -> El {
    let focus = match pane {
        Pane::Main => "draft",
        Pane::Thread => "thread-draft",
    };
    let b = IconButton::new(icon)
        .label(label)
        .help(label)
        .control_size(ControlSize::Small)
        .variant(if active {
            IconButtonVariant::Contrast
        } else {
            IconButtonVariant::Ghost
        })
        .disabled(locked)
        .on_press_tx(move |s: &mut State, tx| {
            if !locked {
                on_press(s);
                tx.focus(focus, false);
            }
        })
        .build(k)
        .key(format!("{}{key}", pane.prefix()));
    if locked { b.inert() } else { b }
}

fn bar_button(
    k: &Kit,
    key: &str,
    label: &str,
    active: bool,
    locked: bool,
    on_press: impl Fn(&mut State) + 'static,
) -> El {
    let b = Button::new(label)
        .help(if active {
            "Show rendered message"
        } else {
            "Show Markdown source"
        })
        .control_size(ControlSize::Small)
        .variant(if active {
            ButtonVariant::Contrast
        } else {
            ButtonVariant::Ghost
        })
        .disabled(locked)
        .on_press(move |s: &mut State| {
            if !locked {
                on_press(s);
            }
        })
        .build(k)
        .key(key);
    if locked { b.inert() } else { b }
}

fn separator(k: &Kit) -> El {
    el().w(1.0).h(16.0).fill(k.c.border_base)
}

pub(crate) fn composer(s: &State, locked: bool) -> (El, El) {
    build(s, locked, Pane::Main)
}

pub(crate) fn thread_composer(s: &State, locked: bool) -> (El, El) {
    build(s, locked, Pane::Thread)
}

fn build(s: &State, locked: bool, pane: Pane) -> (El, El) {
    let k = workspace_theme();
    let edit = pane.edit(s);
    let access = pane.access();
    let raw = pane == Pane::Main && s.raw;
    let block = edit.current_block();
    let mark = |m: Mark| edit.has_mark(&m);
    let bar_on = !raw;
    let tool = |key: &str, icon: &'static Icon, label: &str, active: bool, f: fn(&mut TextEdit)| {
        bar_icon(
            (&k, pane),
            key,
            icon,
            label,
            active && bar_on,
            locked || !bar_on,
            move |s| f(access(s)),
        )
    };
    let linked = edit.active_link().is_some();
    let size = f32::from(s.composer_font_size);
    let style = TextStyle {
        size,
        line_height: (size * 1.35 * 2.0).round() / 2.0,
        family: crate::settings::font_family(s.composer_font_family),
        ..k.ty.ui
    };
    let bar = row()
        .key(format!("{}toolbar", pane.prefix()))
        .gap(4.0)
        .center_y()
        .grow(1.0)
        .shrink()
        .min_w(0.0)
        .flex_wrap()
        .child(tool(
            "bold",
            &icons::TEXT_B,
            "Bold",
            mark(Mark::Bold),
            |e| e.toggle_mark(Mark::Bold),
        ))
        .child(tool(
            "italic",
            &icons::TEXT_ITALIC,
            "Italic",
            mark(Mark::Italic),
            |e| e.toggle_mark(Mark::Italic),
        ))
        .child(tool(
            "strike",
            &icons::TEXT_STRIKETHROUGH,
            "Strikethrough",
            mark(Mark::Strike),
            |e| e.toggle_mark(Mark::Strike),
        ))
        .child(tool(
            "code",
            &icons::CODE,
            "Inline code",
            mark(Mark::Code),
            |e| e.toggle_mark(Mark::Code),
        ))
        .child(separator(&k))
        .child(tool("link", &icons::LINK, "Link", linked, |e| {
            let next = if e.active_link().is_some() {
                None
            } else {
                Some("https://")
            };
            e.set_link(next);
        }))
        .child(separator(&k))
        .child(tool(
            "bullet",
            &icons::LIST_BULLETS,
            "Bulleted list",
            matches!(block, Block::Bullet(_)),
            |e| e.toggle_block(Block::Bullet(0)),
        ))
        .child(tool(
            "numbered",
            &icons::LIST_NUMBERS,
            "Numbered list",
            matches!(block, Block::Numbered(_)),
            |e| e.toggle_block(Block::Numbered(0)),
        ))
        .child(tool(
            "quote",
            &icons::QUOTES,
            "Quote",
            block == Block::Quote,
            |e| e.toggle_block(Block::Quote),
        ))
        .child(tool(
            "codeblock",
            &icons::CODE_BLOCK,
            "Code block",
            block == Block::Code,
            |e| e.toggle_block(Block::Code),
        ))
        .children((pane == Pane::Main).then(|| separator(&k)))
        .children((pane == Pane::Main).then(|| {
            bar_button(
                &k,
                "view-source",
                if s.raw { "Rendered" } else { "Markdown" },
                s.raw,
                locked,
                |s| s.toggle_raw(),
            )
        }))
        .children((pane == Pane::Main).then(|| {
            bar_button(&k, "create-poll", "Create poll", false, locked, |s| {
                s.open_create_poll()
            })
        }));
    let submit: fn(&mut State) = match pane {
        Pane::Main => |s| s.send(),
        Pane::Thread => |s| s.send_thread(),
    };
    let area = if raw {
        field(
            &k,
            &s.source,
            "Message Markdown source",
            vec![],
            (s.caret(k.c.text_base), style),
            (pane, submit),
        )
        .on_edit(|s: &mut State| &mut s.source)
    } else {
        let spans = code_spans(edit, &SyntaxTheme::from_kit(&k));
        field(
            &k,
            edit,
            "Message",
            spans,
            (s.caret(k.c.text_base), style),
            (pane, submit),
        )
        .on_edit(move |s: &mut State| access(s))
    };
    let area = rune::col()
        .role("textbox")
        .padding(8.0)
        .min_h(80.0)
        .w_full()
        .radius(k.radius.md)
        .fill(k.c.bg_base)
        .child(rune::auto_grow(area, 4, 10));
    let area = k
        .shadow_layers(k.elevation.input())
        .fold(area, |e, sh| e.box_shadow(sh))
        .key(format!("{}draft", pane.prefix()));
    (area, bar)
}

fn field(
    k: &Kit,
    edit: &TextEdit,
    label: &str,
    spans: Vec<Span>,
    (caret, style): (Color, TextStyle),
    (pane, submit): (Pane, fn(&mut State)),
) -> El {
    let c = &k.c;
    let rich = RichStyle {
        link: c.text_accent,
        code_fg: None,
        code_bg: c.layer_03,
        code_block_bg: c.layer_02,
        quote_bar: c.border_strong,
        marker: Some(c.text_muted),
    };
    text_input(edit, style)
        .key(format!("{}input", pane.prefix()))
        .w_full()
        .color(c.text_base)
        .rich_style(rich)
        .spans(spans)
        .placeholder("Write a message…", c.text_faint)
        .caret(caret, k.selection())
        .label(label)
        .description("")
        .on_submit(move |s: &mut State, _| submit(s))
}
