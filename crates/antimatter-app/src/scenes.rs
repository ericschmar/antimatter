use crate::state::*;
use antimatter_services::{
    conversation::Unread,
    mattermost::{Channel, Post},
    websocket,
};
use std::collections::HashMap;

pub(crate) fn synthetic_workspace(s: &mut State) {
    s.application = true;
    s.synthetic = true;
    s.account = Some("Synthetic conversation · no real account".into());
    s.channel = Some("synthetic-channel".into());
    s.navigation.tabs = vec!["synthetic-channel".into()];
    s.navigation.favorites = vec!["synthetic-other".into()];
    s.navigation.archived = vec!["synthetic-archived".into()];
    s.channels = ["synthetic-channel", "synthetic-other", "synthetic-archived"]
        .into_iter()
        .map(|id| Channel {
            id: id.into(),
            team_id: "synthetic-team".into(),
            name: id.into(),
            display_name: id.into(),
            kind: "O".into(),
        })
        .chain(std::iter::once(Channel {
            id: "synthetic-dm".into(),
            team_id: String::new(),
            name: "synthetic-user__synthetic-peer".into(),
            display_name: "synthetic-peer".into(),
            kind: "D".into(),
        }))
        .collect();
    s.peer_presence = HashMap::from([
        ("synthetic-peer".into(), "online".into()),
        ("synthetic-user".into(), "online".into()),
    ]);
    s.members = vec!["synthetic-user".into(), "synthetic-peer".into()];
    s.names
        .insert("synthetic-user".into(), "Ada Lovelace".into());
    s.authenticated =
        antimatter_services::mattermost::ServerOrigin::new("https://synthetic.example", true)
            .ok()
            .and_then(|origin| {
                let user =
                    serde_json::from_value(serde_json::json!({"id": "synthetic-user"})).ok()?;
                antimatter_services::accounts::AccountKey::new(&origin, &user).ok()
            });
    s.unread = HashMap::from([(
        "synthetic-other".into(),
        Unread {
            messages: 4,
            mentions: 2,
        },
    )]);
    s.ready = true;
    s.connection = websocket::State::Connected;
    s.posts.push(Post {
        id: "synthetic-post".into(),
        channel_id: "synthetic-channel".into(),
        user_id: "synthetic-user".into(),
        message: "Synthetic service conversation, ping @here and @synthetic".into(),
        create_at: 1,
        update_at: 0,
        delete_at: 0,
        pending_post_id: String::new(),
        metadata: antimatter_services::mattermost::PostMetadata {
            reactions: ["synthetic-user", "synthetic-peer"]
                .iter()
                .map(|u| antimatter_services::mattermost::Reaction {
                    user_id: (*u).into(),
                    emoji_name: "+1".into(),
                })
                .chain([antimatter_services::mattermost::Reaction {
                    user_id: "synthetic-peer".into(),
                    emoji_name: "tada".into(),
                }])
                .collect(),
            files: ["diagram.png", "photo.jpg"]
                .iter()
                .map(|name| antimatter_services::mattermost::FileInfo {
                    id: format!("synthetic-{name}"),
                    name: (*name).into(),
                    extension: "png".into(),
                    size: 2048,
                    mime_type: "image/png".into(),
                })
                .collect(),
        },
    });
    s.posts.push(Post {
        id: "synthetic-multiline".into(),
        channel_id: "synthetic-channel".into(),
        user_id: "synthetic-user".into(),
        message: "Synthetic multiline message\n\nSecond paragraph, so the header must sit on the first line.\n\n```sh\n$ pied-piper bench\nratio 2.61\n```".into(),
        create_at: 2,
        update_at: 0,
        delete_at: 0,
        pending_post_id: String::new(),
        metadata: Default::default(),
    });
}

pub(crate) fn synthetic_history(s: &mut State) {
    synthetic_workspace(s);
    s.has_older = true;
    s.posts = (0..40)
        .map(|i| Post {
            id: format!("synthetic-history-{i}"),
            channel_id: "synthetic-channel".into(),
            user_id: "synthetic-user".into(),
            message: format!("Synthetic history message {i}"),
            create_at: 1_000 + i as i64,
            update_at: 0,
            delete_at: 0,
            pending_post_id: String::new(),
            metadata: Default::default(),
        })
        .collect();
}
