use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{ClassType, DeclaredClass, declare_class, msg_send, msg_send_id, mutability};
use objc2_app_kit::{NSApplication, NSWindow};
use objc2_authentication_services::{
    ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSBundle, NSDictionary, NSError, NSString, NSURL,
};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

pub const BUNDLE_IDENTIFIER: &str = "antimatter.ericschmar.dev";
pub const CALLBACK_SCHEME: &str = "mattermost-dev";

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
    NotMainThread,
    MissingWindow,
    BundleIdentifierMismatch,
    CallbackSchemeNotRegistered,
}

// objc2 0.5 has no downcast API. Check each plist object's class before casting;
// plist generic types alone do not validate the contents of an NSArray/NSDictionary.
fn plist_object<T: ClassType>(object: &AnyObject) -> Option<&T> {
    unsafe {
        let matches: bool = msg_send![object, isKindOfClass: T::class()];
        matches.then(|| &*(object as *const AnyObject).cast::<T>())
    }
}

fn check_bundle(bundle: &NSBundle) -> Result<(), BrowserError> {
    let identifier = unsafe { bundle.bundleIdentifier() };
    if identifier.as_ref().map(|id| id.to_string()).as_deref() != Some(BUNDLE_IDENTIFIER) {
        return Err(BrowserError::BundleIdentifierMismatch);
    }
    let types =
        unsafe { bundle.objectForInfoDictionaryKey(&NSString::from_str("CFBundleURLTypes")) };
    let registered = types
        .as_deref()
        .and_then(plist_object::<NSArray<AnyObject>>)
        .is_some_and(|types| {
            types.iter().any(|entry| {
                plist_object::<NSDictionary<NSString, AnyObject>>(entry)
                    .and_then(|entry| entry.get(&NSString::from_str("CFBundleURLSchemes")))
                    .and_then(plist_object::<NSArray<AnyObject>>)
                    .is_some_and(|schemes| {
                        schemes.iter().any(|scheme| {
                            plist_object::<NSString>(scheme)
                                .is_some_and(|scheme| scheme.to_string() == CALLBACK_SCHEME)
                        })
                    })
            })
        });
    if !registered {
        return Err(BrowserError::CallbackSchemeNotRegistered);
    }
    Ok(())
}

/// Check the running executable's bundle metadata without opening a browser.
/// This checks the bundle declaration, not LaunchServices ownership or delivery.
/// Call on the UI thread; a bare Cargo executable fails closed.
pub fn native_prerequisites() -> Result<(), BrowserError> {
    MainThreadMarker::new().ok_or(BrowserError::NotMainThread)?;
    check_bundle(&NSBundle::mainBundle())
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
    /// Retain Rune's existing key/main window as the presentation anchor.
    pub fn start_for_app(login_url: &url::Url) -> Result<(Self, BrowserCallback), BrowserError> {
        let main_thread = MainThreadMarker::new().ok_or(BrowserError::NotMainThread)?;
        native_prerequisites()?;
        let app = NSApplication::sharedApplication(main_thread);
        let window = app
            .keyWindow()
            .or_else(|| unsafe { app.mainWindow() })
            .ok_or(BrowserError::MissingWindow)?;
        Self::start(main_thread, window, login_url)
    }

    pub fn start(
        main_thread: MainThreadMarker,
        window: Retained<NSWindow>,
        login_url: &url::Url,
    ) -> Result<(Self, BrowserCallback), BrowserError> {
        native_prerequisites()?;
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
        let scheme = NSString::from_str(CALLBACK_SCHEME);
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

    #[test]
    #[ignore = "run on the UI thread inside the actual native app bundle; never opens a browser"]
    fn actual_native_bundle_metadata() {
        assert_eq!(native_prerequisites(), Ok(()));
    }

    #[tokio::test]
    async fn cancellation_settles_receiver_and_rejects_late_success() {
        let (sender, receiver) = oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        complete(&sender, Err(BrowserError::Cancelled));
        complete(&sender, Ok(Zeroizing::new("synthetic-callback".into())));
        assert_eq!(receiver.await.unwrap(), Err(BrowserError::Cancelled));
    }
}
