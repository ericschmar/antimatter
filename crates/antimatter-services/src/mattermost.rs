use std::{fmt, time::Duration};

use reqwest::{Method, Response, header};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use url::Url;
use zeroize::Zeroizing;

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

    fn matches(&self, url: &Url) -> bool {
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
}

pub struct HttpError {
    status: u16,
    id: Option<String>,
    message: Option<String>,
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
        }
    }
}

impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl std::error::Error for Error {}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    #[serde(default)]
    pub nickname: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub roles: String,
    #[serde(default)]
    pub locale: String,
    #[serde(default)]
    pub delete_at: i64,
    #[serde(default)]
    pub last_picture_update: i64,
}

impl User {
    pub fn display_name(&self) -> String {
        let full = [self.first_name.trim(), self.last_name.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if !full.is_empty() {
            full
        } else if !self.nickname.trim().is_empty() {
            self.nickname.trim().to_owned()
        } else if !self.username.trim().is_empty() {
            self.username.trim().to_owned()
        } else {
            self.id.clone()
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub team_id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChannelUnread {
    pub channel_id: String,
    #[serde(default)]
    pub msg_count: u64,
    #[serde(default)]
    pub mention_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Post {
    pub id: String,
    pub channel_id: String,
    pub user_id: String,
    pub message: String,
    pub create_at: i64,
    #[serde(default)]
    pub update_at: i64,
    #[serde(default)]
    pub delete_at: i64,
    #[serde(default)]
    pub pending_post_id: String,
    #[serde(default)]
    pub root_id: String,
    #[serde(default)]
    pub metadata: PostMetadata,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct PostMetadata {
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    #[serde(default)]
    pub files: Vec<FileInfo>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct FileInfo {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub extension: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mime_type: String,
}

impl FileInfo {
    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Reaction {
    pub user_id: String,
    pub emoji_name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PostPage {
    pub order: Vec<String>,
    pub posts: std::collections::HashMap<String, Post>,
    pub prev_post_id: Option<String>,
    pub has_next: Option<bool>,
}

#[derive(Clone, Serialize)]
pub struct CreatePost {
    pub channel_id: String,
    pub message: String,
    pub pending_post_id: String,
}

#[derive(Clone)]
pub struct Client {
    origin: ServerOrigin,
    token: Secret,
    http: reqwest::Client,
}

fn http_client() -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| Error::Transport)
}

async fn checked(response: Response) -> Result<Response, Error> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.ok();
    let field = |name| {
        body.as_ref()
            .and_then(|value| value.get(name))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    Err(Error::Http(HttpError {
        status,
        id: field("id"),
        message: field("message").or_else(|| field("error")),
    }))
}

async fn decode<T: DeserializeOwned>(response: Response) -> Result<T, Error> {
    let bytes = response.bytes().await.map_err(|_| Error::Transport)?;
    serde_json::from_slice(if bytes.is_empty() { b"null" } else { &bytes })
        .map_err(|_| Error::Decode)
}

impl Client {
    pub fn new(origin: ServerOrigin, token: Secret) -> Result<Self, Error> {
        header::HeaderValue::from_str(&format!("Bearer {}", token.expose()))
            .map_err(|_| Error::InvalidSecret)?;
        Ok(Self {
            origin,
            token,
            http: http_client()?,
        })
    }

    pub fn origin(&self) -> &ServerOrigin {
        &self.origin
    }

    pub fn credential_for_persistence(&self) -> Secret {
        self.token.clone()
    }

    pub async fn websocket(
        &self,
        stop: tokio::sync::watch::Receiver<bool>,
        events: tokio::sync::mpsc::Sender<crate::websocket::Event>,
    ) {
        let secret = Secret::new(self.token.expose().to_owned()).expect("validated token");
        crate::websocket::run(self.origin.clone(), secret, stop, events).await;
    }

    pub async fn me(&self) -> Result<User, Error> {
        let user: User = self.get("/users/me").await?;
        if user.id.trim().is_empty() {
            return Err(Error::InvalidUser);
        }
        Ok(user)
    }

    fn request(&self, method: Method, url: Url) -> Result<reqwest::RequestBuilder, Error> {
        if !self.origin.matches(&url) || url.fragment().is_some() {
            return Err(Error::InvalidEndpoint);
        }
        let mut authorization =
            header::HeaderValue::from_str(&format!("Bearer {}", self.token.expose()))
                .map_err(|_| Error::InvalidSecret)?;
        authorization.set_sensitive(true);
        Ok(self
            .http
            .request(method, url)
            .header(header::AUTHORIZATION, authorization))
    }

    async fn json<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, Error> {
        let mut request = self.request(method, self.origin.endpoint(path)?)?;
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(|_| Error::Transport)?;
        decode(checked(response).await?).await
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, Error> {
        self.json::<T, ()>(Method::GET, path, None).await
    }

    pub async fn post<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, Error> {
        self.json(Method::POST, path, Some(body)).await
    }

    pub async fn put<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, Error> {
        self.json(Method::PUT, path, Some(body)).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T, Error> {
        self.json::<T, ()>(Method::DELETE, path, None).await
    }

    pub async fn patch<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, Error> {
        self.json(Method::PATCH, path, Some(body)).await
    }

    pub async fn teams(&self) -> Result<Vec<Team>, Error> {
        self.get("/users/me/teams").await
    }

    pub async fn site_name(&self) -> Result<String, Error> {
        let config: Value = self.get("/config/client?format=old").await?;
        Ok(config
            .get("SiteName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    pub async fn users_by_ids(&self, ids: &[String]) -> Result<Vec<User>, Error> {
        self.post("/users/ids", ids).await
    }

    pub async fn users_by_usernames(&self, names: &[String]) -> Result<Vec<User>, Error> {
        self.post("/users/usernames", names).await
    }

    pub async fn statuses(&self, ids: &[String]) -> Result<Vec<(String, String)>, Error> {
        let statuses: Value = self.post("/users/status/ids", ids).await?;
        Ok(statuses
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let user = entry.get("user_id")?.as_str()?.to_owned();
                let status = entry.get("status")?.as_str()?.to_owned();
                Some((user, status))
            })
            .collect())
    }

    pub async fn status(&self, user_id: &str) -> Result<String, Error> {
        let status: Value = self.get(&segments(&["users", user_id, "status"])?).await?;
        Ok(status
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    pub async fn channels(&self, team_id: &str, page: u32) -> Result<Vec<Channel>, Error> {
        let path = segments(&["users", "me", "teams", team_id, "channels"])?;
        self.get(&format!("{path}?page={page}&per_page=200")).await
    }

    pub async fn channel(&self, id: &str) -> Result<Channel, Error> {
        self.get(&segments(&["channels", id])?).await
    }

    pub async fn channel_unread(&self, id: &str) -> Result<ChannelUnread, Error> {
        self.get(&segments(&["users", "me", "channels", id, "unread"])?)
            .await
    }

    pub async fn channel_members(&self, id: &str, page: u32) -> Result<Value, Error> {
        let path = segments(&["channels", id, "members"])?;
        self.get(&format!("{path}?page={page}&per_page=200")).await
    }

    pub async fn search_channels(&self, team_id: &str, term: &str) -> Result<Value, Error> {
        self.post(
            &segments(&["teams", team_id, "channels", "search"])?,
            &serde_json::json!({"term": term}),
        )
        .await
    }

    pub async fn create_channel<B: Serialize + ?Sized>(&self, body: &B) -> Result<Value, Error> {
        self.post("/channels", body).await
    }

    pub async fn direct_channel(&self, ids: &[String]) -> Result<Value, Error> {
        self.post("/channels/direct", ids).await
    }

    pub async fn group_channel(&self, ids: &[String]) -> Result<Value, Error> {
        self.post("/channels/group", ids).await
    }

    pub async fn add_channel_member(
        &self,
        channel_id: &str,
        user_id: &str,
    ) -> Result<Value, Error> {
        self.post(
            &segments(&["channels", channel_id, "members"])?,
            &serde_json::json!({"user_id": user_id}),
        )
        .await
    }

    pub async fn view_channel(
        &self,
        user_id: &str,
        channel_id: &str,
        previous_channel_id: &str,
    ) -> Result<Value, Error> {
        self.post(
            &segments(&["channels", "members", user_id, "view"])?,
            &serde_json::json!({"channel_id": channel_id, "prev_channel_id": previous_channel_id}),
        )
        .await
    }

    pub async fn posts(&self, channel_id: &str, before: Option<&str>) -> Result<PostPage, Error> {
        let path = segments(&["channels", channel_id, "posts"])?;
        let mut url = self.origin.endpoint(&path)?;
        url.query_pairs_mut()
            .append_pair("per_page", "60")
            .append_pair("page", "0");
        if let Some(before) = before {
            url.query_pairs_mut().append_pair("before", before);
        }
        let response = self
            .request(Method::GET, url)?
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        decode(checked(response).await?).await
    }

    pub async fn thread(&self, post_id: &str) -> Result<Value, Error> {
        self.get(&segments(&["posts", post_id, "thread"])?).await
    }

    pub async fn search_posts(&self, terms: &str, is_or_search: bool) -> Result<PostPage, Error> {
        self.post(
            "/posts/search",
            &serde_json::json!({"terms": terms, "is_or_search": is_or_search}),
        )
        .await
    }

    pub async fn create_post(&self, body: &CreatePost) -> Result<Post, Error> {
        self.post("/posts", body).await
    }

    pub async fn update_post<B: Serialize + ?Sized>(
        &self,
        id: &str,
        body: &B,
    ) -> Result<Value, Error> {
        self.put(&segments(&["posts", id])?, body).await
    }

    pub async fn patch_post<B: Serialize + ?Sized>(
        &self,
        id: &str,
        body: &B,
    ) -> Result<Value, Error> {
        self.put(&segments(&["posts", id, "patch"])?, body).await
    }

    pub async fn delete_post(&self, id: &str) -> Result<Value, Error> {
        self.delete(&segments(&["posts", id])?).await
    }

    pub async fn reactions(&self, post_id: &str) -> Result<Value, Error> {
        self.get(&segments(&["posts", post_id, "reactions"])?).await
    }

    pub async fn add_reaction(
        &self,
        user_id: &str,
        post_id: &str,
        emoji: &str,
    ) -> Result<Value, Error> {
        self.post(
            "/reactions",
            &serde_json::json!({"user_id": user_id, "post_id": post_id, "emoji_name": emoji}),
        )
        .await
    }

    pub async fn remove_reaction(
        &self,
        user_id: &str,
        post_id: &str,
        emoji: &str,
    ) -> Result<Value, Error> {
        self.delete(&segments(&[
            "users",
            user_id,
            "posts",
            post_id,
            "reactions",
            emoji,
        ])?)
        .await
    }

    pub async fn upload_file(
        &self,
        channel_id: &str,
        filename: &str,
        bytes: Vec<u8>,
    ) -> Result<Value, Error> {
        let form = reqwest::multipart::Form::new()
            .text("channel_id", channel_id.to_owned())
            .part(
                "files",
                reqwest::multipart::Part::bytes(bytes).file_name(filename.to_owned()),
            );
        let response = self
            .request(Method::POST, self.origin.endpoint("/files")?)?
            .multipart(form)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        decode(checked(response).await?).await
    }

    pub async fn media(&self, url: &Url) -> Result<Vec<u8>, Error> {
        let response = self
            .request(Method::GET, url.clone())?
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        Ok(checked(response)
            .await?
            .bytes()
            .await
            .map_err(|_| Error::Transport)?
            .to_vec())
    }

    pub async fn profile_image(&self, user_id: &str) -> Result<Vec<u8>, Error> {
        let path = segments(&["users", user_id, "image"])?;
        self.media(&self.origin.endpoint(&path)?).await
    }

    pub async fn custom_profile_image(&self, user_id: &str) -> Result<Vec<u8>, Error> {
        let users = self.users_by_ids(&[user_id.to_owned()]).await?;
        match users.iter().find(|user| user.id == user_id) {
            Some(user) if user.last_picture_update > 0 => self.profile_image(user_id).await,
            _ => Err(Error::InvalidUser),
        }
    }

    pub async fn file(&self, id: &str, preview: bool) -> Result<Vec<u8>, Error> {
        let path = if preview {
            segments(&["files", id, "preview"])?
        } else {
            segments(&["files", id])?
        };
        self.media(&self.origin.endpoint(&path)?).await
    }
}

fn segments(parts: &[&str]) -> Result<String, Error> {
    if parts
        .iter()
        .any(|part| part.is_empty() || matches!(*part, "." | ".."))
    {
        return Err(Error::InvalidEndpoint);
    }
    let mut url = Url::parse("https://endpoint.invalid").expect("constant URL");
    url.path_segments_mut()
        .expect("hierarchical URL")
        .clear()
        .extend(parts);
    Ok(url.path().to_owned())
}

pub async fn sign_in_pat(origin: ServerOrigin, token: Secret) -> Result<(Client, User), Error> {
    let client = Client::new(origin, token)?;
    let user = client.me().await?;
    Ok((client, user))
}

async fn exchange(
    origin: ServerOrigin,
    request: reqwest::RequestBuilder,
) -> Result<(Client, User), Error> {
    let response = checked(request.send().await.map_err(|_| Error::Transport)?).await?;
    let token = response
        .headers()
        .get("Token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(Error::MissingToken)?;
    let token = Secret::new(token.to_owned()).map_err(|_| Error::MissingToken)?;
    drop(response);
    sign_in_pat(origin, token).await
}

pub async fn sign_in_password(
    origin: ServerOrigin,
    login_id: &str,
    password: Secret,
) -> Result<(Client, User), Error> {
    #[derive(Serialize)]
    struct Login<'a> {
        login_id: &'a str,
        password: &'a str,
    }
    let request = http_client()?
        .post(origin.endpoint("/users/login")?)
        .json(&Login {
            login_id,
            password: password.expose(),
        });
    drop(password);
    exchange(origin, request).await
}

pub struct SamlAttempt {
    origin: ServerOrigin,
    client_token: Secret,
    generation: u64,
    consumed: bool,
}

impl SamlAttempt {
    pub fn new(origin: ServerOrigin, generation: u64) -> Self {
        Self {
            origin,
            client_token: Secret::new(uuid::Uuid::new_v4().to_string()).expect("nonempty UUID"),
            generation,
            consumed: false,
        }
    }

    pub fn login_url(&self) -> Url {
        let mut url = Url::parse(&format!("{}/login/sso/saml", self.origin.as_str()))
            .expect("validated origin");
        url.query_pairs_mut()
            .append_pair("desktop_token", self.client_token.expose());
        url
    }

    pub fn cancel(&mut self) {
        self.consumed = true;
    }

    pub fn consume(&mut self, callback: &Url, generation: u64) -> Result<Secret, Error> {
        if std::mem::replace(&mut self.consumed, true)
            || generation != self.generation
            || callback.scheme() != "mattermost-dev"
            || callback.host_str() != Some("login")
            || !matches!(callback.path(), "" | "/")
            || callback.port().is_some()
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.fragment().is_some()
        {
            return Err(Error::InvalidCallback);
        }
        let mut seen = std::collections::HashSet::new();
        let mut client_token = None;
        let mut server_token = None;
        for (key, value) in callback.query_pairs() {
            if !seen.insert(key.to_string()) {
                return Err(Error::InvalidCallback);
            }
            match key.as_ref() {
                "client_token" => client_token = Some(value),
                "server_token" => server_token = Some(value),
                _ => return Err(Error::InvalidCallback),
            }
        }
        if client_token.as_deref() != Some(self.client_token.expose()) {
            return Err(Error::InvalidCallback);
        }
        Secret::new(server_token.ok_or(Error::InvalidCallback)?.into_owned())
            .map_err(|_| Error::InvalidCallback)
    }

    pub async fn sign_in(
        &mut self,
        callback: &Url,
        generation: u64,
    ) -> Result<(Client, User), Error> {
        let token = self.consume(callback, generation)?;
        sign_in_saml(self.origin.clone(), token).await
    }
}

pub async fn sign_in_saml(
    origin: ServerOrigin,
    server_token: Secret,
) -> Result<(Client, User), Error> {
    #[derive(Serialize)]
    struct DesktopToken<'a> {
        token: &'a str,
        device_id: &'a str,
    }
    let request = http_client()?
        .post(origin.endpoint("/users/login/desktop_token")?)
        .json(&DesktopToken {
            token: server_token.expose(),
            device_id: "",
        });
    drop(server_token);
    exchange(origin, request).await
}

#[cfg(test)]
mod tests;
