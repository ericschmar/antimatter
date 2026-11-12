// Development-only prefill for the sign-in fields. Debug builds read `.env.local` (git-ignored)
// once at launch; release builds compile this module out and never read the file.

use crate::state::State;
use rune::TextEdit;
use std::path::Path;

const FALLBACK: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/.env.local");

pub(crate) fn prefill(s: &mut State) {
    let file = std::env::var("ANTIMATTER_DEV_ENV").unwrap_or_else(|_| FALLBACK.to_owned());
    let text = match std::fs::read_to_string(Path::new(&file)) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("dev_login: cannot read {file}: {error}");
            return;
        }
    };
    eprintln!("dev_login: read {file} ({} bytes)", text.len());
    let mut server = None;
    let mut login = None;
    let mut password = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            eprintln!("dev_login: skipped line without '=' (contents not shown)");
            continue;
        };
        let value = value.trim().to_owned();
        match key.trim() {
            "ANTIMATTER_DEV_SERVER" => server = Some(value),
            "ANTIMATTER_DEV_LOGIN" => login = Some(value),
            "ANTIMATTER_DEV_PASSWORD" => password = Some(value),
            other => eprintln!("dev_login: ignored key {other:?}"),
        }
    }
    eprintln!(
        "dev_login: found server={} login={} password={}",
        server.is_some(),
        login.is_some(),
        password.is_some()
    );
    if let Some(server) = server {
        s.server = TextEdit::new(server);
    }
    if let Some(login) = login {
        s.login = TextEdit::new(login);
    }
    if let Some(password) = password {
        s.password = TextEdit::new(password).secure();
        s.method = 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_app_crate_env_file() {
        let mut s = State::default();
        prefill(&mut s);
        assert!(!s.login.text.is_empty(), "login not read from {FALLBACK}");
    }
}
