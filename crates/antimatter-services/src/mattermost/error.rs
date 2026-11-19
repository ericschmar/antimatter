use super::*;

pub enum Error {
    InvalidOrigin,
    InvalidEndpoint,
    InvalidSecret,
    InvalidUser,
    InvalidCallback,
    MissingToken,
    Transport,
    Decode,
    Http(HttpError),
    Redirect(Url),
}

pub struct HttpError {
    pub(super) status: u16,
    pub(super) id: Option<String>,
    pub(super) message: Option<String>,
}

impl HttpError {
    pub fn server_details(&self) -> (Option<&str>, Option<&str>) {
        (self.id.as_deref(), self.message.as_deref())
    }
}

impl Error {
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Http(error) => Some(error.status),
            _ => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOrigin => f.write_str("Invalid server origin or disallowed HTTP"),
            Self::InvalidEndpoint => f.write_str("Invalid or cross-origin endpoint"),
            Self::InvalidSecret => f.write_str("A nonempty credential is required"),
            Self::InvalidUser => f.write_str("Server returned an invalid user identity"),
            Self::InvalidCallback => f.write_str("Invalid, stale or consumed SAML callback"),
            Self::MissingToken => f.write_str("Sign-in response omitted a valid token"),
            Self::Transport => f.write_str("Network request failed; its outcome may be unknown"),
            Self::Decode => f.write_str("Invalid server response"),
            Self::Http(error) => write!(f, "Mattermost request failed (HTTP {})", error.status),
            Self::Redirect(_) => {
                f.write_str("Mattermost redirected the media request off the server")
            }
        }
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl std::error::Error for Error {}
