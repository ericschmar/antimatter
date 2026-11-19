// Optional Giphy key for the composer GIF search. Read once at launch from the
// `GIPHY_API_KEY` environment variable, or else from the git-ignored `.env.local`
// beside this crate. It is held in memory only and never written to settings or logs.

const FALLBACK: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/.env.local");

pub(crate) fn load() -> Option<String> {
    let from_file = std::fs::read_to_string(FALLBACK)
        .ok()
        .and_then(|text| parse(&text));
    pick(std::env::var("GIPHY_API_KEY").ok(), from_file)
}

fn parse(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "GIPHY_API_KEY").then(|| value.trim().to_owned())
    })
}

fn pick(from_env: Option<String>, from_file: Option<String>) -> Option<String> {
    [from_env, from_file]
        .into_iter()
        .flatten()
        .map(|key| key.trim().to_owned())
        .find(|key| !key.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_wins_over_file_and_blanks_are_absent() {
        assert_eq!(parse("A=1\nGIPHY_API_KEY = k1 \n").as_deref(), Some("k1"));
        assert_eq!(
            pick(Some(" env ".into()), Some("file".into())).as_deref(),
            Some("env")
        );
        assert_eq!(
            pick(Some("  ".into()), Some("file".into())).as_deref(),
            Some("file")
        );
        assert_eq!(pick(Some(" ".into()), None), None);
    }
}
