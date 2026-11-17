use rune::Color;
use std::collections::BTreeMap;

/// The palette new users are assigned from, in order.
pub(crate) const PALETTE: [&str; 32] = [
    "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
    "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
    "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
    "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
];

/// FNV-1a, so a user gets the same palette slot in every run. `DefaultHasher` is seeded per
/// process and would reshuffle the colours on each launch.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// The `#rrggbb` a user's name is drawn in: their own pick if they made one, else their
/// assigned palette colour.
pub(crate) fn hex_for(picks: &BTreeMap<String, String>, user_id: &str) -> String {
    picks
        .get(user_id)
        .cloned()
        .unwrap_or_else(|| PALETTE[(fnv1a(user_id) % PALETTE.len() as u64) as usize].to_owned())
}

pub(crate) fn color_for(picks: &BTreeMap<String, String>, user_id: &str) -> Color {
    rgb(&hex_for(picks, user_id)).unwrap_or(Color::WHITE)
}

pub(crate) fn rgb(hex: &str) -> Option<Color> {
    let (r, g, b) = parse(hex)?;
    Some(Color {
        r: f32::from(r) / 255.0,
        g: f32::from(g) / 255.0,
        b: f32::from(b) / 255.0,
        a: 1.0,
    })
}

pub(crate) fn parse(hex: &str) -> Option<(u8, u8, u8)> {
    let digits = hex.strip_prefix('#')?;
    if digits.len() != 6 {
        return None;
    }
    let value = u32::from_str_radix(digits, 16).ok()?;
    Some(((value >> 16) as u8, (value >> 8) as u8, value as u8))
}

pub(crate) fn format((r, g, b): (u8, u8, u8)) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_user_gets_the_same_palette_colour_every_run() {
        let picks = BTreeMap::new();
        assert_eq!(fnv1a("user-a"), 0xf84b_52aa_7549_c3e4);
        assert_eq!(hex_for(&picks, "user-a"), PALETTE[4]);
        assert_eq!(hex_for(&picks, "user-a"), hex_for(&picks, "user-a"));
    }

    #[test]
    fn a_saved_pick_overrides_the_assigned_colour() {
        let mut picks = BTreeMap::new();
        picks.insert("user-a".to_owned(), "#00ff00".to_owned());
        assert_eq!(hex_for(&picks, "user-a"), "#00ff00");
        assert_eq!(
            hex_for(&picks, "user-b"),
            PALETTE[(fnv1a("user-b") % 32) as usize]
        );
    }

    #[test]
    fn hex_round_trips_and_rejects_malformed_values() {
        assert_eq!(parse("#be4a2f"), Some((0xbe, 0x4a, 0x2f)));
        assert_eq!(format((0xbe, 0x4a, 0x2f)), "#be4a2f");
        assert_eq!(parse("be4a2f"), None);
        assert_eq!(parse("#be4a2"), None);
        assert_eq!(parse("#zzzzzz"), None);
    }
}
