use scraper::{Html, Selector};
use std::time::Duration;
use url::Url;

const MAX_BODY: usize = 1 << 20;

#[derive(Clone, Debug, PartialEq)]
pub struct Preview {
    pub url: String,
    pub site: String,
    pub title: String,
    pub description: String,
    pub image: Option<Vec<u8>>,
}

pub fn first_url(message: &str) -> Option<Url> {
    message.split_whitespace().find_map(|w| {
        let start = w.find("http://").or_else(|| w.find("https://"))?;
        Url::parse(w[start..].trim_end_matches([')', '.', ',', '>'])).ok()
    })
}

pub fn parse(page: &str, url: &Url) -> Option<Preview> {
    let html = Html::parse_document(page);
    let meta = |key: &str| {
        let selector = Selector::parse("meta").ok()?;
        html.select(&selector)
            .find(|m| {
                m.value().attr("property") == Some(key) || m.value().attr("name") == Some(key)
            })
            .and_then(|m| m.value().attr("content"))
            .map(|c| c.trim().to_owned())
            .filter(|c| !c.is_empty())
    };
    let title = meta("og:title").or_else(|| {
        let selector = Selector::parse("title").ok()?;
        let t = html.select(&selector).next()?.text().collect::<String>();
        Some(t.trim().to_owned()).filter(|t| !t.is_empty())
    })?;
    Some(Preview {
        url: url.to_string(),
        site: meta("og:site_name").unwrap_or_else(|| url.host_str().unwrap_or_default().to_owned()),
        title,
        description: meta("og:description")
            .or_else(|| meta("description"))
            .unwrap_or_default(),
        image: None,
    })
}

pub fn image_url(page: &str, url: &Url) -> Option<Url> {
    let html = Html::parse_document(page);
    let selector = Selector::parse("meta[property='og:image']").ok()?;
    let content = html.select(&selector).next()?.value().attr("content")?;
    url.join(content)
        .ok()
        .filter(|u| matches!(u.scheme(), "http" | "https"))
}

pub async fn fetch(url: Url) -> Option<Preview> {
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")
        .build()
        .ok()?;
    let response = http.get(url.clone()).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    let page = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_BODY)]).into_owned();
    let mut preview = parse(&page, &url)?;
    if let Some(image) = image_url(&page, &url)
        && let Ok(response) = http.get(image).send().await
        && response.status().is_success()
        && let Ok(bytes) = response.bytes().await
        && bytes.len() <= MAX_BODY * 4
    {
        preview.image = Some(bytes.to_vec());
    }
    Some(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_graph_and_falls_back() {
        let url = Url::parse("https://example.com/a").unwrap();
        let page = r#"<html><head><title>Plain</title><meta property="og:title" content="Rich"><meta property="og:image" content="/i.png"></head></html>"#;
        let p = parse(page, &url).unwrap();
        assert_eq!((p.title.as_str(), p.site.as_str()), ("Rich", "example.com"));
        assert_eq!(
            image_url(page, &url).unwrap().as_str(),
            "https://example.com/i.png"
        );
        assert_eq!(parse("<title>Plain</title>", &url).unwrap().title, "Plain");
        assert!(parse("<p>none</p>", &url).is_none());
        assert_eq!(
            first_url("see (https://a.io/x). ok").unwrap().as_str(),
            "https://a.io/x"
        );
    }
}
