use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{ClassType, DeclaredClass, declare_class, msg_send_id, mutability};
use objc2_app_kit::NSWindow;
use objc2_authentication_services::{
    ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession,
};
use objc2_foundation::{MainThreadMarker, NSError, NSString, NSURL};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

declare_class!(
    struct PresentationProvider;

    unsafe impl ClassType for PresentationProvider {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "AntimatterRustAuthenticationAnchor";
    }

    impl DeclaredClass for PresentationProvider {
        type Ivars = Retained<NSWindow>;
    }

    unsafe impl NSObjectProtocol for PresentationProvider {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for PresentationProvider {
        #[method_id(presentationAnchorForWebAuthenticationSession:)]
        fn anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSWindow> {
            self.ivars().clone()
        }
    }
);

#[derive(Debug, PartialEq, Eq)]
pub enum BrowserError {
    Cancelled,
    StartFailed,
    InvalidUrl,
}

type CallbackResult = Result<Zeroizing<String>, BrowserError>;
type CallbackSender = Arc<Mutex<Option<oneshot::Sender<CallbackResult>>>>;
pub type BrowserCallback = oneshot::Receiver<CallbackResult>;

fn complete(sender: &CallbackSender, result: CallbackResult) {
    if let Some(sender) = sender.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = sender.send(result);
    }
}

pub struct BrowserSession {
    session: Retained<ASWebAuthenticationSession>,
    _provider: Retained<PresentationProvider>,
    sender: CallbackSender,
}

impl BrowserSession {
    pub fn start(
        main_thread: MainThreadMarker,
        window: Retained<NSWindow>,
        login_url: &url::Url,
    ) -> Result<(Self, BrowserCallback), BrowserError> {
        if !matches!(login_url.scheme(), "https" | "http") {
            return Err(BrowserError::InvalidUrl);
        }
        let provider = main_thread
            .alloc::<PresentationProvider>()
            .set_ivars(window);
        let provider: Retained<PresentationProvider> =
            unsafe { msg_send_id![super(provider), init] };
        let (sender, receiver) = oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        let callback_sender = sender.clone();
        let completion = RcBlock::new(move |url: *mut NSURL, _error: *mut NSError| {
            let result = unsafe { url.as_ref() }
                .and_then(|url| unsafe { url.absoluteString() })
                .map(|url| Zeroizing::new(url.to_string()))
                .ok_or(BrowserError::Cancelled);
            complete(&callback_sender, result);
        });
        let url = unsafe { NSURL::URLWithString(&NSString::from_str(login_url.as_str())) }
            .ok_or(BrowserError::InvalidUrl)?;
        let scheme = NSString::from_str("mattermost-dev");
        #[allow(deprecated)]
        let session = unsafe {
            ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
                ASWebAuthenticationSession::alloc(),
                &url,
                Some(&scheme),
                &*completion as *const _ as *mut _,
            )
        };
        unsafe {
            session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*provider)));
            if !session.start() {
                return Err(BrowserError::StartFailed);
            }
        }
        Ok((
            Self {
                session,
                _provider: provider,
                sender,
            },
            receiver,
        ))
    }

    pub fn cancel(&self, _: MainThreadMarker) {
        complete(&self.sender, Err(BrowserError::Cancelled));
        unsafe { self.session.cancel() };
    }
}

impl Drop for BrowserSession {
    fn drop(&mut self) {
        complete(&self.sender, Err(BrowserError::Cancelled));
        unsafe { self.session.cancel() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_settles_receiver_and_rejects_late_success() {
        let (sender, receiver) = oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        complete(&sender, Err(BrowserError::Cancelled));
        complete(&sender, Ok(Zeroizing::new("synthetic-callback".into())));
        assert_eq!(receiver.await.unwrap(), Err(BrowserError::Cancelled));
    }
}
