use serde::Deserialize;
use std::time::Duration;
use url::Url;

pub const ENDPOINT: &str = "https://api.giphy.com/v1/gifs/search";

#[derive(Clone, Debug, PartialEq)]
pub struct Gif {
    pub title: String,
    pub url: Url,
}

#[derive(Deserialize)]
struct Response {
    data: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    title: String,
    images: Images,
}

#[derive(Deserialize)]
struct Images {
    original: Image,
}

#[derive(Deserialize)]
struct Image {
    url: String,
}

pub async fn search(endpoint: &str, api_key: &str, query: &str) -> Option<Vec<Gif>> {
    let mut url = Url::parse(endpoint).ok()?;
    url.query_pairs_mut()
        .append_pair("api_key", api_key)
        .append_pair("q", query);
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let response: Response = http
        .get(url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    Some(
        response
            .data
            .into_iter()
            .filter_map(|item| {
                let url = Url::parse(&item.images.original.url)
                    .ok()
                    .filter(|u| matches!(u.scheme(), "http" | "https"))?;
                Some(Gif {
                    title: item.title,
                    url,
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path, query_param},
    };

    #[tokio::test]
    async fn searches_with_key_and_keeps_only_web_originals() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/search"))
            .and(query_param("api_key", "key"))
            .and(query_param("q", "cat"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    {"title": "Cat", "images": {"original": {"url": "https://media.giphy.com/cat.gif"}}},
                    {"title": "Bad", "images": {"original": {"url": "javascript:alert(1)"}}}
                ]
            })))
            .mount(&server)
            .await;
        let gifs = search(&format!("{}/search", server.uri()), "key", "cat")
            .await
            .unwrap();
        assert_eq!(gifs.len(), 1);
        assert_eq!(gifs[0].title, "Cat");
        assert_eq!(gifs[0].url.as_str(), "https://media.giphy.com/cat.gif");
    }

    #[tokio::test]
    async fn rejected_key_yields_no_results() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        assert!(search(&server.uri(), "bad", "cat").await.is_none());
    }
}
