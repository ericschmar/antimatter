use super::*;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ServerOrigin(String);

impl ServerOrigin {
    pub fn new(raw: &str, allow_http: bool) -> Result<Self, Error> {
        let raw = raw.trim();
        if raw.is_empty() || raw.chars().any(char::is_whitespace) {
            return Err(Error::InvalidOrigin);
        }
        let input = if raw.contains("://") {
            raw.to_owned()
        } else {
            format!("https://{raw}")
        };
        let authority = input.split_once("://").ok_or(Error::InvalidOrigin)?.1;
        let tail = authority.find(['/', '?', '#']).map(|i| &authority[i..]);
        if authority.contains(['@', '\\']) || !matches!(tail, None | Some("/")) {
            return Err(Error::InvalidOrigin);
        }
        let url = Url::parse(&input).map_err(|_| Error::InvalidOrigin)?;
        if !matches!(url.scheme(), "https" | "http")
            || (url.scheme() == "http" && !allow_http)
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::InvalidOrigin);
        }
        Ok(Self(url.origin().ascii_serialization()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn endpoint(&self, path: &str) -> Result<Url, Error> {
        if !path.starts_with('/') || path.starts_with("//") || path.contains(['\\', '#']) {
            return Err(Error::InvalidEndpoint);
        }
        let path = if path == "/api/v4" || path.starts_with("/api/v4/") {
            path.to_owned()
        } else {
            format!("/api/v4{path}")
        };
        let url = Url::parse(&format!("{}{path}", self.0)).map_err(|_| Error::InvalidEndpoint)?;
        if !self.matches(&url) || !url.path().starts_with("/api/v4/") {
            return Err(Error::InvalidEndpoint);
        }
        Ok(url)
    }

    pub fn websocket_url(&self) -> Url {
        let mut url = self.endpoint("/websocket").expect("validated origin");
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme).expect("compatible websocket scheme");
        url
    }

    pub fn matches(&self, url: &Url) -> bool {
        url.origin().ascii_serialization() == self.0
            && url.username().is_empty()
            && url.password().is_none()
    }
}

#[derive(Clone)]
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(value: String) -> Result<Self, Error> {
        let value = Zeroizing::new(value);
        if value.trim().is_empty() {
            return Err(Error::InvalidSecret);
        }
        Ok(Self(value))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}
