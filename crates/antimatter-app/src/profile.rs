use crate::state::State;
use antimatter_services::mattermost::User;
use rune::TextEdit;

pub(crate) const STATUSES: [(&str, &str); 4] = [
    ("online", "Online"),
    ("away", "Away"),
    ("dnd", "Do not disturb"),
    ("offline", "Offline"),
];

#[derive(Default)]
pub(crate) struct ProfileForm {
    pub(crate) first_name: TextEdit,
    pub(crate) last_name: TextEdit,
    pub(crate) nickname: TextEdit,
    pub(crate) username: TextEdit,
    pub(crate) email: TextEdit,
    pub(crate) custom_status: TextEdit,
    pub(crate) status: usize,
    pub(crate) loaded: bool,
    pub(crate) busy: bool,
    pub(crate) message: Option<String>,
}

impl ProfileForm {
    pub(crate) fn fill(&mut self, user: &User, status: &str) {
        self.first_name = TextEdit::new(user.first_name.clone());
        self.last_name = TextEdit::new(user.last_name.clone());
        self.nickname = TextEdit::new(user.nickname.clone());
        self.username = TextEdit::new(user.username.clone());
        self.email = TextEdit::new(user.email.clone());
        let custom = user
            .props
            .get("customStatus")
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .and_then(|v| v.get("text")?.as_str().map(str::to_owned))
            .unwrap_or_default();
        self.custom_status = TextEdit::new(custom);
        self.status = STATUSES.iter().position(|(v, _)| *v == status).unwrap_or(0);
        self.loaded = true;
    }
}

impl State {
    pub(crate) fn load_profile(&mut self) {
        let (Some(client), Some(runtime), Some(settings)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let Ok(user) = client.me().await else {
                settings.update(|s, _| s.profile.message = Some("Could not load profile.".into()));
                return;
            };
            let status = client.status(&user.id).await.unwrap_or_default();
            settings.update(move |s, _| {
                s.profile.fill(&user, &status);
                s.profile.message = None;
            });
        });
    }

    pub(crate) fn save_profile(&mut self, values: [String; 6], status: &'static str) {
        let (Some(client), Some(runtime), Some(settings), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
            self.authenticated.as_ref().map(|k| k.user_id().to_owned()),
        ) else {
            return;
        };
        let [first_name, last_name, nickname, username, email, custom] = values;
        runtime.spawn(async move {
            let patch = serde_json::json!({
                "first_name": first_name,
                "last_name": last_name,
                "nickname": nickname,
                "username": username,
                "email": email,
            });
            let result = async {
                client.patch_me(&patch).await?;
                client.set_status(&me, status).await?;
                client.set_custom_status(&custom).await?;
                Ok::<_, antimatter_services::mattermost::Error>(())
            }
            .await;
            settings.update(move |s, _| {
                s.profile.busy = false;
                s.profile.message = Some(match result {
                    Ok(()) => "Profile saved.".into(),
                    Err(_) => "Could not save profile. Your edits are kept.".into(),
                });
            });
        });
    }

    pub(crate) fn upload_avatar(&mut self, path: std::path::PathBuf) {
        let (Some(client), Some(runtime), Some(settings), Some(handle), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
            self.handle.clone(),
            self.authenticated.as_ref().map(|k| k.user_id().to_owned()),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "avatar".into());
            let message = match std::fs::read(&path) {
                Ok(bytes) => match client.upload_profile_image(&me, &name, bytes).await {
                    Ok(_) => {
                        let bytes = client.custom_profile_image(&me).await.ok();
                        let id = me.clone();
                        handle.update(move |s, _| s.avatars.finish(id, bytes));
                        "Photo updated."
                    }
                    Err(_) => "Could not upload the photo.",
                },
                Err(_) => "Could not read that file.",
            };
            settings.update(move |s, _| s.profile.message = Some(message.into()));
        });
    }
}
