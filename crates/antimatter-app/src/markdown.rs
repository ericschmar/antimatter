use rune::{Block, Mark, MarkRange, TextEdit};

// ponytail: no escaping and only a line-based subset (bold, italic, strike, code, link,
// bullet/numbered lists, quote, fenced code). Plain text containing markers re-parses as
// formatting; upgrade to a pulldown-cmark walk if that bites.
pub(crate) fn from_markdown(md: &str) -> TextEdit {
    let (mut text, mut marks, mut blocks) = (String::new(), vec![], vec![]);
    let mut fenced = false;
    for line in md.split('\n') {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if !blocks.is_empty() {
            text.push('\n');
        }
        if fenced {
            blocks.push(Block::Code);
            text.push_str(line);
            continue;
        }
        let body = line.trim_start_matches(' ');
        let level = ((line.len() - body.len()) / 2) as u8;
        let digits = body.chars().take_while(char::is_ascii_digit).count();
        let (block, rest) = if let Some(r) = body.strip_prefix("- ").or(body.strip_prefix("* ")) {
            (Block::Bullet(level), r)
        } else if digits > 0 && body[digits..].starts_with(". ") {
            (Block::Numbered(level), &body[digits + 2..])
        } else if let Some(r) = body.strip_prefix("> ") {
            (Block::Quote, r)
        } else {
            (Block::Paragraph, line)
        };
        blocks.push(block);
        inline(rest, &mut text, &mut marks);
    }
    editor(TextEdit::from_parts(text, marks, blocks))
}

pub(crate) fn editor(edit: TextEdit) -> TextEdit {
    edit.allow_marks([
        Mark::Bold,
        Mark::Italic,
        Mark::Strike,
        Mark::Code,
        Mark::Link(String::new()),
    ])
    .allow_blocks([
        Block::Bullet(0),
        Block::Numbered(0),
        Block::Quote,
        Block::Code,
    ])
}

fn inline(s: &str, text: &mut String, marks: &mut Vec<MarkRange>) {
    let mut rest = s;
    while let Some(c) = rest.chars().next() {
        let pair = [
            ("**", Mark::Bold),
            ("~~", Mark::Strike),
            ("*", Mark::Italic),
            ("`", Mark::Code),
        ]
        .into_iter()
        .find_map(|(d, m)| {
            let inner = rest.strip_prefix(d)?;
            let end = inner.find(d).filter(|&i| i > 0)?;
            Some((d.len(), end, m))
        });
        if let Some((n, end, mark)) = pair {
            let start = text.len();
            if mark == Mark::Code {
                text.push_str(&rest[n..n + end]);
            } else {
                inline(&rest[n..n + end], text, marks);
            }
            marks.push(MarkRange::new(start..text.len(), mark));
            rest = &rest[n + end + n..];
            continue;
        }
        if c == '['
            && let Some(mid) = rest.find("](")
            && let Some(close) = rest[mid + 2..].find(')')
        {
            let start = text.len();
            inline(&rest[1..mid], text, marks);
            let url = rest[mid + 2..mid + 2 + close].to_owned();
            marks.push(MarkRange::new(start..text.len(), Mark::Link(url)));
            rest = &rest[mid + 3 + close..];
            continue;
        }
        text.push(c);
        rest = &rest[c.len_utf8()..];
    }
}

pub(crate) fn to_markdown(edit: &TextEdit) -> String {
    let mut out: Vec<String> = vec![];
    let mut numbered: Vec<u32> = vec![];
    let mut fenced = false;
    for p in edit.paragraphs() {
        let line = &edit.text[p.range.clone()];
        let line = line.strip_suffix('\n').unwrap_or(line);
        if (p.block == Block::Code) != fenced {
            fenced = !fenced;
            out.push("```".into());
        }
        if !matches!(p.block, Block::Numbered(_)) {
            numbered.clear();
        }
        let indent = |l: u8| "  ".repeat(l as usize);
        let body = || inline_md(edit, p.range.start, line);
        out.push(match p.block {
            Block::Code => line.to_owned(),
            Block::Paragraph => body(),
            Block::Quote => format!("> {}", body()),
            Block::Bullet(l) => format!("{}- {}", indent(l), body()),
            Block::Numbered(l) => {
                numbered.truncate(l as usize + 1);
                numbered.resize(l as usize + 1, 0);
                numbered[l as usize] += 1;
                format!("{}{}. {}", indent(l), numbered[l as usize], body())
            }
        });
    }
    if fenced {
        out.push("```".into());
    }
    out.join("\n")
}

fn inline_md(edit: &TextEdit, base: usize, line: &str) -> String {
    let end = base + line.len();
    let marks: Vec<_> = edit
        .marks()
        .iter()
        .filter(|m| m.start >= base && m.end <= end && m.start < m.end)
        .filter(|m| !matches!(m.mark, Mark::Underline | Mark::Pill(_)))
        .collect();
    let mut out = String::new();
    let boundary = |out: &mut String, at: usize| {
        let mut closing: Vec<_> = marks.iter().filter(|m| m.end == at).collect();
        closing.sort_by_key(|m| std::cmp::Reverse(m.start));
        for m in closing {
            out.push_str(&close(&m.mark));
        }
        let mut opening: Vec<_> = marks.iter().filter(|m| m.start == at).collect();
        opening.sort_by_key(|m| std::cmp::Reverse(m.end));
        for m in opening {
            out.push_str(open(&m.mark));
        }
    };
    for (i, c) in line.char_indices() {
        boundary(&mut out, base + i);
        out.push(c);
    }
    boundary(&mut out, end);
    out
}

fn open(mark: &Mark) -> &'static str {
    match mark {
        Mark::Bold => "**",
        Mark::Italic => "*",
        Mark::Strike => "~~",
        Mark::Code => "`",
        Mark::Link(_) => "[",
        _ => "",
    }
}

fn close(mark: &Mark) -> String {
    match mark {
        Mark::Link(url) => format!("]({url})"),
        other => open(other).to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_round_trips() {
        for md in [
            "plain text",
            "a **bold** and *it* and ~~gone~~ and `code`",
            "[site](https://example.com) here",
            "- one\n  - nested\n1. first\n2. second\n> quoted\nafter",
            "```\nfn x() {}\n  y\n```\nend",
            "**bold *both* bold**",
        ] {
            assert_eq!(to_markdown(&from_markdown(md)), md, "{md}");
        }
        assert_eq!(from_markdown("a **b**").text, "a b");
        assert_eq!(to_markdown(&TextEdit::new("keep text")), "keep text");
    }
}
