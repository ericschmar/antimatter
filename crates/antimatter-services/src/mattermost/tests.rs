use super::*;
use serde_json::json;
use tokio::net::TcpListener;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

fn origin() -> ServerOrigin {
    ServerOrigin::new("CHAT.example:443/", false).unwrap()
}

fn local(server: &MockServer) -> ServerOrigin {
    ServerOrigin::new(&server.uri(), true).unwrap()
}

#[test]
fn origins_and_endpoint_policy() {
    assert!(origin() == ServerOrigin::new("https://chat.example", false).unwrap());
    assert_eq!(origin().as_str(), "https://chat.example");
    assert_eq!(
        origin().websocket_url().as_str(),
        "wss://chat.example/api/v4/websocket"
    );
    assert_eq!(
        origin().endpoint("/users/me").unwrap().path(),
        "/api/v4/users/me"
    );
    assert_eq!(
        serde_json::to_string(&origin()).unwrap(),
        "\"https://chat.example\""
    );
    for raw in [
        "",
        "http://chat.example",
        "https://a/path",
        "https://a/a/..",
        "https://a?",
        "https://a#",
        "https://u:p@a",
        "https://@a",
        "https://a//",
        "ftp://a",
        "https://a\\evil",
    ] {
        assert!(ServerOrigin::new(raw, false).is_err(), "{raw}");
    }
    assert!(
        ServerOrigin::new("http://[::1]:8080", true)
            .unwrap()
            .as_str()
            == "http://[::1]:8080"
    );
    assert!(ServerOrigin::new("https://chat.example:444", false).unwrap() != origin());
    for path in [
        "https://evil/users",
        "//evil/users",
        "/../../outside",
        "/users#fragment",
        "/\\evil",
    ] {
        assert!(origin().endpoint(path).is_err(), "{path}");
    }
    assert_eq!(
        format!("{:?}", Secret::new("fake-secret".into()).unwrap()),
        "Secret([REDACTED])"
    );
    assert!(Secret::new("  ".into()).is_err());
}

#[test]
fn display_name_prefers_first_and_last_name() {
    let user = |first: &str, last: &str, nickname: &str, username: &str| {
        serde_json::from_value::<User>(serde_json::json!({
            "id": "u1",
            "username": username,
            "first_name": first,
            "last_name": last,
            "nickname": nickname,
        }))
        .unwrap()
    };
    assert_eq!(
        user("Ada", "Lovelace", "ada", "alovelace").display_name(),
        "Ada Lovelace"
    );
    assert_eq!(user("Ada", "", "ada", "alovelace").display_name(), "Ada");
    assert_eq!(user("", "", "ada", "alovelace").display_name(), "ada");
    assert_eq!(user("", "", "", "alovelace").display_name(), "alovelace");
    assert_eq!(user("", "", "", "").display_name(), "u1");
}

#[tokio::test]
async fn password_token_then_me() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/login"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Token", "synthetic-token")
                .set_body_json(json!({})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/me"))
        .and(header("authorization", "Bearer synthetic-token"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"id":"user1","username":"demo"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let (_, user) = sign_in_password(
        local(&server),
        "demo",
        Secret::new("fake-password".into()).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(user.id, "user1");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests[0].url.path(), "/api/v4/users/login");
    let login: Value = requests[0].body_json().unwrap();
    assert_eq!(login["login_id"], "demo");
    assert!(!requests[0].headers.contains_key("authorization"));
    assert_eq!(requests[1].url.path(), "/api/v4/users/me");
}

#[tokio::test]
async fn statuses_post_ids_and_parse_presence() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/status/ids"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"user_id":"u1","status":"online"},
            {"user_id":"u2","status":"away"},
            {"status":"dnd"}
        ])))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    assert_eq!(
        client.statuses(&["u1".into(), "u2".into()]).await.unwrap(),
        vec![("u1".into(), "online".into()), ("u2".into(), "away".into())]
    );
    let requests = server.received_requests().await.unwrap();
    let ids: Vec<String> = requests[0].body_json().unwrap();
    assert_eq!(ids, ["u1", "u2"]);
}

#[tokio::test]
async fn channel_files_search_lists_the_channel_in_server_order() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/teams/team1/files/search"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "order": ["f2", "f1"],
            "file_infos": {
                "f1": {"id": "f1", "name": "a.pdf", "mime_type": "application/pdf"},
                "f2": {"id": "f2", "name": "b.png", "mime_type": "image/png"}
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    let found = client.search_files("team1", "general").await.unwrap();
    assert_eq!(found.order, ["f2", "f1"]);
    assert_eq!(found.file_infos["f1"].name, "a.pdf");
    let requests = server.received_requests().await.unwrap();
    let body: Value = requests[0].body_json().unwrap();
    assert_eq!(body["terms"], "in:general");
}

#[tokio::test]
async fn profile_image_fetches_user_image_bytes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/user1/image"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Content-Type", "image/png")
                .set_body_bytes(b"png-bytes".to_vec()),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    assert_eq!(client.profile_image("user1").await.unwrap(), b"png-bytes");
    assert!(matches!(
        client.profile_image("").await,
        Err(Error::InvalidEndpoint)
    ));
}

#[tokio::test]
async fn custom_profile_image_skips_default_pictures() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/ids"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"id":"custom","last_picture_update":1700000000000_i64},
            {"id":"default","last_picture_update":0}
        ])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/custom/image"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"png-bytes".to_vec()))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    assert_eq!(
        client.custom_profile_image("custom").await.unwrap(),
        b"png-bytes"
    );
    assert!(client.custom_profile_image("default").await.is_err());
}

#[tokio::test]
async fn pat_and_saml_validate_identity() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":" "})))
        .mount(&server)
        .await;
    assert!(matches!(
        sign_in_pat(local(&server), Secret::new("synthetic".into()).unwrap()).await,
        Err(Error::InvalidUser)
    ));

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/login/desktop_token"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("Token", "synthetic")
                .set_body_json(json!({})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"user2"})))
        .expect(1)
        .mount(&server)
        .await;
    let (_, user) = sign_in_saml(local(&server), Secret::new("fake-desktop".into()).unwrap())
        .await
        .unwrap();
    assert_eq!(user.id, "user2");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests[0].url.path(), "/api/v4/users/login/desktop_token");
    let login: Value = requests[0].body_json().unwrap();
    assert_eq!(login["device_id"], "");
    assert_eq!(requests[1].url.path(), "/api/v4/users/me");
}

#[tokio::test]
async fn missing_token_and_redacted_errors() {
    for headers in [None, Some("")] {
        let server = MockServer::start().await;
        let mut reply = ResponseTemplate::new(200).set_body_json(json!({}));
        if let Some(token) = headers {
            reply = reply.insert_header("Token", token);
        }
        Mock::given(method("POST"))
            .and(path("/api/v4/users/login"))
            .respond_with(reply)
            .mount(&server)
            .await;
        assert!(matches!(
            sign_in_password(local(&server), "demo", Secret::new("fake".into()).unwrap()).await,
            Err(Error::MissingToken)
        ));
    }
    for (body, id, message) in [
        (
            r#"{"id":"private-id","message":"private-token"}"#,
            Some("private-id"),
            Some("private-token"),
        ),
        ("not json", None, None),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v4/users/me"))
            .respond_with(
                ResponseTemplate::new(401)
                    .insert_header("Content-Type", "application/json")
                    .set_body_string(body),
            )
            .mount(&server)
            .await;
        let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
        let error = client.me().await.unwrap_err();
        assert_eq!(error.status(), Some(401));
        assert_eq!(format!("{error:?}"), "Mattermost request failed (HTTP 401)");
        let Error::Http(error) = error else {
            panic!("expected HTTP error");
        };
        assert_eq!(error.id.as_deref(), id);
        assert_eq!(error.message.as_deref(), message);
    }
}

#[tokio::test]
async fn redirects_and_cross_origin_media_rejected() {
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!("http://{}/stolen", target.local_addr().unwrap());
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/login"))
        .respond_with(ResponseTemplate::new(302).insert_header("Location", location.as_str()))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v4/users/login/desktop_token"))
        .respond_with(ResponseTemplate::new(302).insert_header("Location", location.as_str()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/me"))
        .respond_with(ResponseTemplate::new(302).insert_header("Location", location.as_str()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/files/fake"))
        .respond_with(ResponseTemplate::new(302).insert_header("Location", location.as_str()))
        .mount(&server)
        .await;
    for route in 0..4 {
        let error = match route {
            0 => sign_in_password(local(&server), "demo", Secret::new("fake".into()).unwrap())
                .await
                .err()
                .unwrap(),
            1 => sign_in_saml(local(&server), Secret::new("fake".into()).unwrap())
                .await
                .err()
                .unwrap(),
            2 => Client::new(local(&server), Secret::new("fake".into()).unwrap())
                .unwrap()
                .me()
                .await
                .unwrap_err(),
            _ => {
                let client =
                    Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
                client
                    .media(&client.origin.endpoint("/files/fake").unwrap())
                    .await
                    .unwrap_err()
            }
        };
        assert_eq!(error.status(), Some(302));
    }
    let client = Client::new(origin(), Secret::new("fake".into()).unwrap()).unwrap();
    assert!(matches!(
        client.media(&Url::parse(&location).unwrap()).await,
        Err(Error::InvalidEndpoint)
    ));
    assert!(matches!(
        client
            .media(&Url::parse("https://chat.example:444/file").unwrap())
            .await,
        Err(Error::InvalidEndpoint)
    ));
    assert!(
        tokio::time::timeout(Duration::from_millis(30), target.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn pagination_writes_and_empty_delete() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v4/users/me/teams/team1/channels"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v4/channels/channel1/posts"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"order":[],"posts":{},"prev_post_id":""})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v4/posts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id":"post1","channel_id":"channel1","user_id":"user1","message":"synthetic","create_at":1
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/v4/posts/post1"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    client.channels("team1", 2).await.unwrap();
    client.posts("channel1", Some("cursor&safe")).await.unwrap();
    client
        .create_post(&CreatePost {
            channel_id: "channel1".into(),
            message: "synthetic".into(),
            pending_post_id: "stable".into(),
            file_ids: vec![],
            root_id: String::new(),
        })
        .await
        .unwrap();
    assert_eq!(client.delete_post("post1").await.unwrap(), Value::Null);
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests[0].url.query(), Some("page=2&per_page=200"));
    assert_eq!(
        requests[1].url.query(),
        Some("per_page=60&page=0&before=cursor%26safe")
    );
    let post: Value = requests[2].body_json().unwrap();
    assert_eq!(post["pending_post_id"], "stable");
    assert_eq!(requests[3].method.as_str(), "DELETE");
}

#[tokio::test]
async fn ambiguous_write_is_not_retried() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin =
        ServerOrigin::new(&format!("http://{}", listener.local_addr().unwrap()), true).unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(
            tokio::io::AsyncReadExt::read(&mut socket, &mut buffer)
                .await
                .unwrap()
                > 0
        );
        drop(socket);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    });
    let client = Client::new(origin, Secret::new("fake".into()).unwrap()).unwrap();
    assert!(matches!(
        client
            .create_post(&CreatePost {
                channel_id: "channel1".into(),
                message: "synthetic".into(),
                pending_post_id: "stable".into(),
                file_ids: vec![],
                root_id: String::new(),
            })
            .await,
        Err(Error::Transport)
    ));
    task.await.unwrap();
}

#[test]
fn post_search_filters_apply_mattermost_modifiers() {
    let filters = PostSearchFilters {
        channel: "general".into(),
        sender: "alice".into(),
        after: "2026-01-02".into(),
        before: "2026-02-03".into(),
        has_files: true,
        file_extension: ".pdf".into(),
        thread_scope: ThreadScope::Roots,
        pinned_only: true,
        saved_only: true,
    };
    assert!(filters.is_active());
    assert_eq!(
        filters.applying("  budget "),
        "budget in:general from:alice after:2026-01-02 before:2026-02-03 has:files ext:pdf -is:reply is:pinned is:saved"
    );
    assert_eq!(PostSearchFilters::default().applying(" hi "), "hi");
    assert!(!PostSearchFilters::default().is_active());
    let replies = PostSearchFilters {
        thread_scope: ThreadScope::Replies,
        ..Default::default()
    };
    assert_eq!(replies.applying("x"), "x is:reply");
    let partial = PostSearchFilters {
        after: "2026-0".into(),
        before: "not-a-date".into(),
        ..Default::default()
    };
    assert!(!partial.is_active());
    assert_eq!(partial.applying("x"), "x");
}

#[tokio::test]
async fn filtered_search_sends_the_modifiers_as_terms() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v4/posts/search"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"order": [], "posts": {}})))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(local(&server), Secret::new("fake".into()).unwrap()).unwrap();
    client
        .search_posts_filtered(
            "budget",
            &PostSearchFilters {
                sender: "alice".into(),
                has_files: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let body: Value = requests[0].body_json().unwrap();
    assert_eq!(body["terms"], "budget from:alice has:files");
    assert_eq!(body["is_or_search"], false);
}
