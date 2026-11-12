use crate::state::*;
use antimatter_services::{
    accounts::{Account, AccountKey, Draft, Navigation, Persistence},
    mattermost::{self, ServerOrigin},
};
use rune::AppHandle;

pub(crate) fn validate_identity(
    expected: Option<&AccountKey>,
    actual: &AccountKey,
) -> Result<(), &'static str> {
    if expected.is_some_and(|expected| expected != actual) {
        Err("Saved credential belongs to a different user. No account was adopted or changed.")
    } else {
        Ok(())
    }
}

pub(crate) type Authenticated = (
    mattermost::Client,
    mattermost::User,
    AccountKey,
    Option<AccountKey>,
    Option<Vec<Account>>,
    Vec<Draft>,
    Navigation,
);

pub(crate) async fn authenticate(
    login: Login,
    store: Option<Persistence>,
    remember: bool,
    _generation: u64,
    gate: Option<(AppHandle<State>, u64, tokio::sync::watch::Receiver<bool>)>,
) -> Result<Authenticated, &'static str> {
    let mut expected = None;
    let mut replace = None;
    let mut navigation = Navigation::default();
    let mut login_method = None;
    let mut drafts = vec![];
    let login_request = async {
        let result = match login {
            Login::Pat(origin, token, target, method) => {
                replace = target;
                login_method = Some(method);
                mattermost::sign_in_pat(origin, token).await
            }
            Login::Password(origin, login, token, target, method) => {
                replace = target;
                login_method = Some(method);
                mattermost::sign_in_password(origin, &login, token).await
            }
            Login::Saved(key) => {
                let store = store.as_ref().ok_or("Account storage unavailable.")?;
                let (token, saved_drafts, saved_navigation) =
                    store.restore(key.clone()).await.map_err(
                        |_| "Saved sign-in unavailable. Sign in again; existing state is retained.",
                    )?;
                drafts = saved_drafts;
                navigation = saved_navigation;
                let origin =
                    ServerOrigin::new(key.origin(), std::env::args().any(|a| a == "--dev-http"))
                        .map_err(
                            |_| "Saved server is invalid or requires development HTTP opt-in.",
                        )?;
                expected = Some(key);
                mattermost::sign_in_pat(origin, token).await
            }
            #[cfg(target_os = "macos")]
            Login::Saml(mut attempt, callback, target, method) => {
                replace = target;
                login_method = Some(method);
                let callback = callback
                    .await
                    .map_err(|_| "Browser sign-in cancelled.")?
                    .map_err(|_| "Browser sign-in cancelled or failed.")?;
                let url = url::Url::parse(&callback).map_err(|_| "Invalid browser callback.")?;
                attempt.sign_in(&url, _generation).await
            }
        };
        result.map_err(|_| "Sign-in failed. Check the server and credentials.")
    };
    let result = if let Some((_, _, stop)) = &gate {
        let mut stop = stop.clone();
        tokio::select! {
            _ = stop.changed() => return Err("Sign-in cancelled before persistence."),
            result = login_request => result,
        }
    } else {
        login_request.await
    };
    let (client, user) = result?;
    let key = AccountKey::new(client.origin(), &user).map_err(|_| "Invalid signed-in identity.")?;
    if let Some(target) = replace.as_ref() {
        if target.origin() != key.origin() {
            return Err(
                "Edited connection must use the same server. Existing saved sign-in retained.",
            );
        }
        expected = Some(target.clone());
    }
    validate_identity(expected.as_ref(), &key)?;
    let mut saved = None;
    let durable = if expected.is_some() || remember || replace.is_some() {
        let store = store.as_ref().ok_or("Account storage unavailable.")?;
        if let Some((handle, generation, _)) = gate {
            let (tx, rx) = tokio::sync::oneshot::channel();
            handle.update(move |s, _| {
                let accepted = s.scope.accepts(generation);
                if accepted {
                    s.auth_writing = true;
                }
                let _ = tx.send(accepted);
            });
            if !rx.await.unwrap_or(false) {
                return Err("Sign-in cancelled before persistence.");
            }
        }
        if let Some(target) = replace.as_ref() {
            let (accounts, saved_drafts, saved_navigation) = store
                .save_with_method(
                    target.clone(),
                    user.username.clone(),
                    client.credential_for_persistence(),
                    login_method,
                )
                .await
                .map_err(|_| "Could not update saved sign-in. Existing account state retained.")?;
            saved = Some(accounts);
            drafts = saved_drafts;
            navigation = saved_navigation;
        } else if remember && expected.is_none() {
            let (accounts, saved_drafts, saved_navigation) = store
                .save_with_method(
                    key.clone(),
                    user.username.clone(),
                    client.credential_for_persistence(),
                    login_method,
                )
                .await
                .map_err(|_| "Could not remember sign-in. Existing account state retained.")?;
            saved = Some(accounts);
            drafts = saved_drafts;
            navigation = saved_navigation;
        }
        store
            .select(Some(key.clone()))
            .await
            .map_err(|_| "Could not select saved account. Retry connection.")?;
        Some(key.clone())
    } else {
        None
    };
    Ok((client, user, key, durable, saved, drafts, navigation))
}
