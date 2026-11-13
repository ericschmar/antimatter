use rune::{Image, ImageCache, Waker};
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Avatars {
    cache: Option<ImageCache>,
    images: HashMap<String, Image>,
}

impl Avatars {
    pub(crate) fn new(waker: Waker) -> Self {
        Self {
            cache: Some(ImageCache::new(waker)),
            ..Self::default()
        }
    }

    pub(crate) fn get(&self, user_id: &str) -> Option<&Image> {
        self.images.get(user_id).filter(|image| image.is_ready())
    }

    pub(crate) fn finish(&mut self, user_id: String, bytes: Option<Vec<u8>>) {
        let Some(cache) = &self.cache else { return };
        let image = match bytes {
            Some(bytes) => cache.load(bytes),
            None => {
                let options = blobatar::BlobatarOptions {
                    size: Some(96),
                    ..Default::default()
                };
                cache.load(blobatar::render(&user_id, &options).into_bytes())
            }
        };
        self.images.insert(user_id, image);
    }

    pub(crate) fn clear(&mut self) {
        self.images.clear();
    }
}
