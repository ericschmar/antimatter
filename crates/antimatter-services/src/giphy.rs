use serde::Deserialize;
use std::time::Duration;
use url::Url;

pub const SEARCH: &str = "https://api.giphy.com/v1/gifs/search";
pub const TRENDING: &str = "https://api.giphy.com/v1/gifs/trending";
const MAX_MEDIA: usize = 8 << 20;

#[derive(Clone, Debug, PartialEq)]
pub struct Gif {
    pub title: String,
    pub preview: Url,
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
    fixed_width: Image,
}

#[derive(Deserialize)]
struct Image {
    url: String,
}

pub async fn trending(api_key: &str, limit: usize) -> Option<Vec<Gif>> {
    fetch(TRENDING, api_key, &[("limit", limit.to_string())]).await
}

pub async fn fetch_bytes(url: Url) -> Option<Vec<u8>> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .read_timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let bytes = http
        .get(url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .await
        .ok()?;
    (bytes.len() <= MAX_MEDIA).then(|| bytes.to_vec())
}

pub async fn search(api_key: &str, query: &str, limit: usize) -> Option<Vec<Gif>> {
    fetch(
        SEARCH,
        api_key,
        &[("q", query.to_owned()), ("limit", limit.to_string())],
    )
    .await
}

async fn fetch(endpoint: &str, api_key: &str, query: &[(&str, String)]) -> Option<Vec<Gif>> {
    let mut url = Url::parse(endpoint).ok()?;
    url.query_pairs_mut()
        .append_pair("api_key", api_key)
        .extend_pairs(query);
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
                let web = |raw: &str| {
                    Url::parse(raw)
                        .ok()
                        .filter(|u| matches!(u.scheme(), "http" | "https"))
                };
                Some(Gif {
                    title: item.title,
                    preview: web(&item.images.fixed_width.url)?,
                    url: web(&item.images.original.url)?,
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

    fn gif(title: &str, original: &str, preview: &str) -> serde_json::Value {
        json!({"title": title, "images": {
            "original": {"url": original},
            "fixed_width": {"url": preview}
        }})
    }

    #[tokio::test]
    async fn searches_with_key_and_keeps_only_web_urls() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/search"))
            .and(query_param("api_key", "key"))
            .and(query_param("q", "cat"))
            .and(query_param("limit", "24"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    gif("Cat", "https://media.giphy.com/cat.gif", "https://media.giphy.com/cat-s.gif"),
                    gif("Bad", "javascript:alert(1)", "https://media.giphy.com/bad-s.gif")
                ]
            })))
            .mount(&server)
            .await;
        let gifs = fetch(
            &format!("{}/search", server.uri()),
            "key",
            &[("q", "cat".into()), ("limit", "24".into())],
        )
        .await
        .unwrap();
        assert_eq!(gifs.len(), 1);
        assert_eq!(gifs[0].title, "Cat");
        assert_eq!(gifs[0].url.as_str(), "https://media.giphy.com/cat.gif");
        assert_eq!(
            gifs[0].preview.as_str(),
            "https://media.giphy.com/cat-s.gif"
        );
    }

    #[tokio::test]
    async fn trending_sends_no_query() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/trending"))
            .and(query_param("api_key", "key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [gif("Hi", "https://media.giphy.com/hi.gif", "https://media.giphy.com/hi-s.gif")]
            })))
            .mount(&server)
            .await;
        let gifs = fetch(&format!("{}/trending", server.uri()), "key", &[])
            .await
            .unwrap();
        assert_eq!(gifs.len(), 1);
    }

    #[tokio::test]
    async fn rejected_key_yields_no_results() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        assert!(fetch(&server.uri(), "bad", &[]).await.is_none());
    }
}
