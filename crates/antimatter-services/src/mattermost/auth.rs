use super::*;

pub async fn sign_in_pat(origin: ServerOrigin, token: Secret) -> Result<(Client, User), Error> {
    let client = Client::new(origin, token)?;
    let user = client.me().await?;
    Ok((client, user))
}

pub(super) async fn exchange(
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
            || callback.scheme() != "mattermost"
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.fragment().is_some()
        {
            return Err(Error::InvalidCallback);
        }
        let origin = Url::parse(self.origin.as_str()).map_err(|_| Error::InvalidCallback)?;
        let expected_path = format!("{}/login/desktop", origin.path().trim_end_matches('/'));
        let host_matches = callback.host_str().is_some_and(|host| {
            origin
                .host_str()
                .is_some_and(|expected| host.eq_ignore_ascii_case(expected))
        });
        if !host_matches
            || callback.port() != origin.port()
            || callback.path().trim_end_matches('/') != expected_path
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
