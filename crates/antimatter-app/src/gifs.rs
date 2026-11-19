use rune::{Image, ImageCache, Waker};
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Gifs {
    cache: Option<ImageCache>,
    images: HashMap<String, Image>,
}

impl Gifs {
    pub(crate) fn attach(&mut self, waker: Waker) {
        if self.cache.is_none() {
            self.cache = Some(ImageCache::new(waker));
        }
    }

    pub(crate) fn get(&self, url: &str) -> Option<&Image> {
        self.images.get(url).filter(|image| image.is_ready())
    }

    pub(crate) fn finish(&mut self, url: String, bytes: Option<Vec<u8>>) {
        let Some(cache) = &self.cache else { return };
        if let Some(bytes) = bytes {
            self.images.insert(url, cache.load(bytes));
        }
    }
}
