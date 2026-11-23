use crate::state::State;

const REPO_OWNER: &str = "ericschmar";
const REPO_NAME: &str = "antimatter";
const BUNDLE: &str = "Antimatter.app";
const CHECK_EVERY: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum UpdateState {
    Idle,
    Available(String),
    Installing(String),
    Ready(String),
    Failed(String),
}

fn configure() -> self_update::backends::github::UpdateBuilder {
    let mut builder = self_update::backends::github::Update::configure();
    builder
        .repo_owner(REPO_OWNER)
        .repo_name(REPO_NAME)
        .bin_name("antimatter")
        .asset_identifier("macos")
        .bundle_path_in_archive(BUNDLE)
        .current_version(self_update::cargo_crate_version!())
        .show_output(false)
        .show_download_progress(false)
        .no_confirm(true);
    builder
}

fn latest_newer() -> Result<Option<String>, self_update::errors::Error> {
    let releases = configure().build()?.get_newer_releases()?;
    Ok(releases.latest().map(|r| r.version().to_owned()))
}

fn install() -> Result<(), self_update::errors::Error> {
    configure().build()?.update()?;
    Ok(())
}

impl State {
    pub(crate) fn check_for_update(&self) {
        let (Some(runtime), Some(handle)) = (self.runtime.clone(), self.handle.clone()) else {
            return;
        };
        runtime.spawn(async move {
            loop {
                let found = tokio::task::spawn_blocking(latest_newer).await;
                if let Ok(Ok(Some(version))) = found {
                    handle.update(move |s, _| {
                        if matches!(s.update, UpdateState::Idle | UpdateState::Available(_)) {
                            s.update = UpdateState::Available(version);
                        }
                    });
                    return;
                }
                tokio::time::sleep(CHECK_EVERY).await;
            }
        });
    }

    pub(crate) fn check_for_update_now(&self) {
        let (Some(runtime), Some(handle)) = (self.runtime.clone(), self.handle.clone()) else {
            return;
        };
        runtime.spawn(async move {
            let found = tokio::task::spawn_blocking(latest_newer).await;
            let (message, version) = match found {
                Ok(Ok(Some(version))) => {
                    (format!("Antimatter {version} is available."), Some(version))
                }
                Ok(Ok(None)) => (
                    format!("Antimatter {} is up to date.", env!("CARGO_PKG_VERSION")),
                    None,
                ),
                Ok(Err(error)) => (format!("Update check failed: {error}"), None),
                Err(error) => (format!("Update check failed: {error}"), None),
            };
            handle.update(move |s, _| {
                if let Some(version) = version
                    && s.update == UpdateState::Idle
                {
                    s.update = UpdateState::Available(version);
                }
                if let Some(settings) = s.settings_app.clone() {
                    settings.update(move |p, _| p.update_check = Some(message));
                }
            });
        });
    }

    pub(crate) fn install_update(&mut self) {
        let UpdateState::Available(version) = self.update.clone() else {
            return;
        };
        let (Some(runtime), Some(handle)) = (self.runtime.clone(), self.handle.clone()) else {
            return;
        };
        self.update = UpdateState::Installing(version.clone());
        runtime.spawn(async move {
            let result = tokio::task::spawn_blocking(install).await;
            handle.update(move |s, _| {
                s.update = match result {
                    Ok(Ok(())) => UpdateState::Ready(version),
                    Ok(Err(error)) => UpdateState::Failed(error.to_string()),
                    Err(error) => UpdateState::Failed(error.to_string()),
                }
            });
        });
    }

    pub(crate) fn restart_into_update(&mut self) {
        if !matches!(self.update, UpdateState::Ready(_)) {
            return;
        }
        self.close();
        let Err(error) = self_update::restart::restart();
        self.update = UpdateState::Failed(error.to_string());
    }
}
