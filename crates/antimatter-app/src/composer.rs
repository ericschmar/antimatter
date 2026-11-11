use crate::state::*;
use crate::theme::workspace_theme;
use antimatter_theme::icons;
use rune::{Block, El, Icon, Mark, Span, TextEdit, el, row};
use rune_kit::syntax::{SyntaxTheme, highlight};
use rune_kit::{Button, ButtonVariant, ControlSize, IconButton, IconButtonVariant, Kit, TextArea};

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

fn bar_icon(
    k: &Kit,
    key: &str,
    icon: &'static Icon,
    label: &str,
    active: bool,
    locked: bool,
    on_press: impl Fn(&mut State) + 'static,
) -> El {
    let b = IconButton::new(icon)
        .label(label)
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
                tx.focus("draft", false);
            }
        })
        .build(k)
        .key(key);
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
    let k = workspace_theme();
    let edit = &s.draft;
    let block = edit.current_block();
    let mark = |m: Mark| edit.has_mark(&m);
    let bar_on = !s.raw;
    let tool = |key: &str, icon: &'static Icon, label: &str, active: bool, f: fn(&mut TextEdit)| {
        bar_icon(
            &k,
            key,
            icon,
            label,
            active && bar_on,
            locked || !bar_on,
            move |s| f(&mut s.draft),
        )
    };
    let linked = edit.active_link().is_some();
    let bar = row()
        .key("toolbar")
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
        .child(separator(&k))
        .child(bar_button(
            &k,
            "view-source",
            if s.raw { "Rendered" } else { "Markdown" },
            s.raw,
            locked,
            |s| s.toggle_raw(),
        ));
    let area = if s.raw {
        TextArea::new(&s.source)
            .label("Message Markdown source")
            .on_edit(|s: &mut State| &mut s.source)
    } else {
        TextArea::new(&s.draft)
            .label("Message")
            .decorations(code_spans(&s.draft, &SyntaxTheme::from_kit(&k)))
            .on_edit(|s: &mut State| &mut s.draft)
    }
    .placeholder("Write a message…")
    .width(None)
    .auto_grow(4, 10)
    .disabled(locked);
    let area = area.build(&k).key("draft");
    (if locked { area.inert() } else { area }, bar)
}
