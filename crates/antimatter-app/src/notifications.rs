use crate::state::State;
use std::collections::HashMap;

pub(crate) const LEVELS: [(&str, &str); 4] = [
    ("default", "Default"),
    ("all", "All"),
    ("mention", "Mentions"),
    ("none", "Muted"),
];

#[derive(Default)]
pub(crate) struct ServerNotify {
    pub(crate) props: HashMap<String, String>,
    pub(crate) channels: Vec<(String, String, String)>,
    pub(crate) loaded: bool,
    pub(crate) message: Option<String>,
}

impl ServerNotify {
    pub(crate) fn get(&self, key: &str, fallback: &'static str) -> String {
        self.props
            .get(key)
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or_else(|| fallback.to_owned())
    }
}

impl State {
    pub(crate) fn load_notify(&mut self) {
        let (Some(client), Some(runtime), Some(settings)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
        ) else {
            return;
        };
        let teams = self.team_ids.clone();
        let names: HashMap<String, String> = self
            .channels
            .iter()
            .map(|c| (c.id.clone(), c.display_name.clone()))
            .collect();
        runtime.spawn(async move {
            let Ok(user) = client.me().await else {
                settings.update(|s, _| {
                    s.notify.message = Some("Could not load notification preferences.".into());
                });
                return;
            };
            let mut channels = Vec::new();
            for team in teams {
                let Ok(members) = client.my_channel_members(&team).await else {
                    continue;
                };
                for member in members.as_array().into_iter().flatten() {
                    let Some(id) = member.get("channel_id").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let Some(name) = names.get(id) else {
                        continue;
                    };
                    let level = member
                        .get("notify_props")
                        .and_then(|p| p.get("desktop"))
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.is_empty())
                        .unwrap_or("default")
                        .to_owned();
                    channels.push((id.to_owned(), name.clone(), level));
                }
            }
            channels.sort_by_key(|(_, name, _)| name.to_lowercase());
            settings.update(move |s, _| {
                s.notify.props = user.notify_props;
                s.notify.channels = channels;
                s.notify.loaded = true;
                s.notify.message = None;
            });
        });
    }

    pub(crate) fn set_notify_prop(&mut self, key: &'static str, value: String) {
        let (Some(client), Some(runtime), Some(settings)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let result = async {
                let user = client.me().await?;
                let mut props = user.notify_props;
                props.insert(key.to_owned(), value.clone());
                let updated = client
                    .patch_me(&serde_json::json!({"notify_props": props}))
                    .await?;
                Ok::<_, antimatter_services::mattermost::Error>(updated.notify_props)
            }
            .await;
            settings.update(move |s, _| match result {
                Ok(props) => {
                    s.notify.props = props;
                    s.notify.message = None;
                }
                Err(_) => {
                    s.notify.message = Some("Could not save. The server kept its value.".into())
                }
            });
        });
    }

    pub(crate) fn set_channel_level(&mut self, channel: String, level: &'static str) {
        let (Some(client), Some(runtime), Some(settings), Some(me)) = (
            self.client.clone(),
            self.runtime.clone(),
            self.settings_app.clone(),
            self.authenticated.as_ref().map(|k| k.user_id().to_owned()),
        ) else {
            return;
        };
        runtime.spawn(async move {
            let result = client.set_channel_notify(&channel, &me, level).await;
            settings.update(move |s, _| match result {
                Ok(_) => {
                    s.notify.message = None;
                    if let Some(row) = s.notify.channels.iter_mut().find(|c| c.0 == channel) {
                        row.2 = level.to_owned();
                    }
                }
                Err(_) => {
                    s.notify.message = Some("Could not save. The server kept its value.".into())
                }
            });
        });
    }

    pub(crate) fn notify_local(&self, channel_id: &str, sender: &str, message: &str) {
        #[cfg(target_os = "macos")]
        {
            if !self.notifications_enabled || rune::is_headless() {
                return;
            }
            let title = self
                .channels
                .iter()
                .find(|c| c.id == channel_id)
                .map_or("Antimatter", |c| c.display_name.as_str());
            let sound = if self.notification_sounds_enabled {
                " sound name \"Glass\""
            } else {
                ""
            };
            let escape = |s: &str| s.replace(['\\', '"'], "");
            let preview = message.lines().next().unwrap_or_default();
            let script = format!(
                "display notification \"{}: {}\" with title \"{}\"{sound}",
                escape(sender),
                escape(preview),
                escape(title)
            );
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .spawn();
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (channel_id, sender, message);
    }
}
