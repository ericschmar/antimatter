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
    s.channels = ["synthetic-channel", "synthetic-other"]
        .into_iter()
        .map(|id| Channel {
            id: id.into(),
            team_id: "synthetic-team".into(),
            name: id.into(),
            display_name: id.into(),
            kind: "O".into(),
        })
        .collect();
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
        message: "Synthetic service conversation".into(),
        create_at: 1,
        update_at: 0,
        delete_at: 0,
        pending_post_id: String::new(),
    });
}
