use rune::{Image, ImageCache, Waker};
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct Avatars {
    cache: Option<ImageCache>,
    images: HashMap<String, Image>,
    placeholders: RefCell<HashMap<String, Image>>,
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

    pub(crate) fn user(&self, user_id: &str) -> Option<Image> {
        if let Some(image) = self.get(user_id) {
            return Some(image.clone());
        }
        let cache = self.cache.as_ref()?;
        let mut placeholders = self.placeholders.borrow_mut();
        let image = placeholders
            .entry(user_id.to_owned())
            .or_insert_with(|| Self::blobatar(cache, user_id));
        image.is_ready().then(|| image.clone())
    }

    fn blobatar(cache: &ImageCache, user_id: &str) -> Image {
        let options = blobatar::BlobatarOptions {
            size: Some(96),
            ..Default::default()
        };
        cache.load(blobatar::render(user_id, &options).into_bytes())
    }

    pub(crate) fn finish(&mut self, user_id: String, bytes: Option<Vec<u8>>) {
        let Some(cache) = &self.cache else { return };
        let image = match bytes {
            Some(bytes) => cache.load(bytes),
            None => Self::blobatar(cache, &user_id),
        };
        self.images.insert(user_id, image);
    }

    pub(crate) fn clear(&mut self) {
        self.images.clear();
        self.placeholders.borrow_mut().clear();
    }
}
