pub mod accounts;
pub mod conversation;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod mattermost;
pub mod settings;
pub mod websocket;

#[derive(Default)]
pub struct SessionScope {
    generation: u64,
    cancellation: Option<tokio::sync::watch::Sender<bool>>,
}

impl SessionScope {
    pub fn replace(&mut self) -> (u64, tokio::sync::watch::Receiver<bool>) {
        self.cancel();
        let (sender, receiver) = tokio::sync::watch::channel(false);
        self.cancellation = Some(sender);
        (self.generation, receiver)
    }

    pub fn cancel(&mut self) {
        if let Some(sender) = self.cancellation.take() {
            let _ = sender.send(true);
        }
        self.generation = self
            .generation
            .checked_add(1)
            .expect("session generation exhausted");
    }

    pub fn accepts(&self, generation: u64) -> bool {
        self.cancellation.is_some() && self.generation == generation
    }
}

impl Drop for SessionScope {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switching_and_signout_cancel_work_and_reject_late_results() {
        let mut scope = SessionScope::default();
        let (first, stop_first) = scope.replace();
        assert!(scope.accepts(first));
        let (second, stop_second) = scope.replace();
        assert!(*stop_first.borrow());
        assert!(!scope.accepts(first));
        assert!(scope.accepts(second));
        scope.cancel();
        assert!(*stop_second.borrow());
        assert!(!scope.accepts(second));
    }
}
