use super::*;

#[derive(Clone)]
pub struct Client {
    pub(super) origin: ServerOrigin,
    pub(super) token: Secret,
    pub(super) http: reqwest::Client,
}

pub(super) fn http_client() -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| Error::Transport)
}

pub(super) async fn checked(response: Response) -> Result<Response, Error> {
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

pub(super) async fn decode<T: DeserializeOwned>(response: Response) -> Result<T, Error> {
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
        typing: tokio::sync::mpsc::Receiver<crate::websocket::Typing>,
    ) {
        let secret = Secret::new(self.token.expose().to_owned()).expect("validated token");
        crate::websocket::run(self.origin.clone(), secret, stop, events, typing).await;
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

    pub async fn patch_me<B: Serialize + ?Sized>(&self, body: &B) -> Result<User, Error> {
        self.put("/users/me/patch", body).await
    }

    pub async fn set_status(&self, user_id: &str, status: &str) -> Result<Value, Error> {
        self.put(
            &segments(&["users", user_id, "status"])?,
            &serde_json::json!({"user_id": user_id, "status": status}),
        )
        .await
    }

    pub async fn set_custom_status(&self, text: &str) -> Result<Value, Error> {
        if text.trim().is_empty() {
            return self.delete("/users/me/status/custom").await;
        }
        self.put(
            "/users/me/status/custom",
            &serde_json::json!({"emoji": "speech_balloon", "text": text}),
        )
        .await
    }

    pub async fn upload_profile_image(
        &self,
        user_id: &str,
        filename: &str,
        bytes: Vec<u8>,
    ) -> Result<Value, Error> {
        let form = reqwest::multipart::Form::new().part(
            "image",
            reqwest::multipart::Part::bytes(bytes).file_name(filename.to_owned()),
        );
        let path = segments(&["users", user_id, "image"])?;
        let response = self
            .request(Method::POST, self.origin.endpoint(&path)?)?
            .multipart(form)
            .send()
            .await
            .map_err(|_| Error::Transport)?;
        decode(checked(response).await?).await
    }

    pub async fn my_channel_members(&self, team_id: &str) -> Result<Value, Error> {
        self.get(&segments(&[
            "users", "me", "teams", team_id, "channels", "members",
        ])?)
        .await
    }

    pub async fn set_channel_notify(
        &self,
        channel_id: &str,
        user_id: &str,
        level: &str,
    ) -> Result<Value, Error> {
        self.put(
            &segments(&["channels", channel_id, "members", user_id, "notify_props"])?,
            &serde_json::json!({"desktop": level, "push": level}),
        )
        .await
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

    pub async fn team_users(&self, team_id: &str) -> Result<Vec<User>, Error> {
        let path = segments(&["users"])?;
        let mut url = self.origin.endpoint(&path)?;
        url.query_pairs_mut()
            .append_pair("in_team", team_id)
            .append_pair("per_page", "200")
            .append_pair("sort", "");
        self.get(&format!("/users?{}", url.query().unwrap_or_default()))
            .await
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

    pub async fn threads(&self, user_id: &str, team_id: &str) -> Result<ThreadPage, Error> {
        let path = segments(&["users", user_id, "teams", team_id, "threads"])?;
        self.get(&format!("{path}?unread=true&pageSize=25")).await
    }

    pub async fn read_thread(
        &self,
        user_id: &str,
        team_id: &str,
        thread_id: &str,
    ) -> Result<Value, Error> {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis())
            .to_string();
        let path = segments(&[
            "users", user_id, "teams", team_id, "threads", thread_id, "read", &at,
        ])?;
        self.json::<Value, ()>(Method::PUT, &path, None).await
    }

    pub async fn search_posts(&self, terms: &str, is_or_search: bool) -> Result<PostPage, Error> {
        self.post(
            "/posts/search",
            &serde_json::json!({"terms": terms, "is_or_search": is_or_search}),
        )
        .await
    }

    pub async fn search_posts_filtered(
        &self,
        query: &str,
        filters: &PostSearchFilters,
    ) -> Result<PostPage, Error> {
        self.search_posts(&filters.applying(query), false).await
    }

    pub async fn search_files(
        &self,
        team_id: &str,
        channel_name: &str,
    ) -> Result<FileSearch, Error> {
        let path = segments(&["teams", team_id, "files", "search"])?;
        self.post(
            &path,
            &serde_json::json!({
                "terms": format!("in:{channel_name}"),
                "is_or_search": false,
                "include_deleted_channels": false,
            }),
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

    pub async fn create_poll(
        &self,
        channel_id: &str,
        team_id: &str,
        question: &str,
        options: &[String],
    ) -> Result<(), Error> {
        let quote = |text: &str| format!("\"{}\"", text.replace('"', "\\\""));
        let arguments: Vec<String> = std::iter::once(question)
            .chain(options.iter().map(String::as_str))
            .map(quote)
            .collect();
        let command = format!("/poll {} --progress", arguments.join(" "));
        let _: Value = self
            .post(
                "/commands/execute",
                &serde_json::json!({"channel_id": channel_id, "team_id": team_id, "command": command}),
            )
            .await?;
        Ok(())
    }

    pub async fn vote_poll(&self, post_id: &str, action_id: &str) -> Result<Post, Error> {
        let _: Value = self
            .post(
                &segments(&["posts", post_id, "actions", action_id])?,
                &serde_json::json!({}),
            )
            .await?;
        self.get(&segments(&["posts", post_id])?).await
    }

    pub async fn end_poll(
        &self,
        post_id: &str,
        channel_id: &str,
        poll_id: &str,
    ) -> Result<Post, Error> {
        let _: Value = self
            .post(
                &segments(&["posts", post_id, "actions", "endPoll"])?,
                &serde_json::json!({}),
            )
            .await?;
        let _: Value = self
            .post(
                "/actions/dialogs/submit",
                &serde_json::json!({
                    "url": format!("/plugins/com.github.matterpoll.matterpoll/api/v1/polls/{poll_id}/end/confirm"),
                    "callback_id": post_id,
                    "channel_id": channel_id,
                    "submission": {},
                }),
            )
            .await?;
        self.get(&segments(&["posts", post_id])?).await
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

    pub async fn custom_emojis(&self) -> Result<Vec<CustomEmoji>, Error> {
        self.get("/emoji?page=0&per_page=200&sort=name").await
    }

    pub async fn custom_emoji_image(&self, id: &str) -> Result<Vec<u8>, Error> {
        let path = segments(&["emoji", id, "image"])?;
        self.media(&self.origin.endpoint(&path)?).await
    }

    pub async fn file(&self, id: &str, preview: bool) -> Result<Vec<u8>, Error> {
        let path = if preview {
            segments(&["files", id, "preview"])?
        } else {
            segments(&["files", id])?
        };
        self.media(&self.origin.endpoint(&path)?).await
    }

    pub async fn proxied_image(&self, source: &Url) -> Result<Vec<u8>, Error> {
        let mut url = self.origin.endpoint("/image")?;
        url.query_pairs_mut().append_pair("url", source.as_str());
        for _ in 0..5 {
            let response = self
                .request(Method::GET, url.clone())?
                .send()
                .await
                .map_err(|_| Error::Transport)?;
            if !response.status().is_redirection() {
                return Ok(checked(response)
                    .await?
                    .bytes()
                    .await
                    .map_err(|_| Error::Transport)?
                    .to_vec());
            }
            let target = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| response.url().join(value).ok())
                .ok_or(Error::Transport)?;
            if !self.origin.matches(&target) {
                return Err(Error::Redirect(target));
            }
            url = target;
        }
        Err(Error::Transport)
    }
}

pub(super) fn segments(parts: &[&str]) -> Result<String, Error> {
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
