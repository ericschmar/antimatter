use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    #[serde(default)]
    pub nickname: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub roles: String,
    #[serde(default)]
    pub locale: String,
    #[serde(default)]
    pub delete_at: i64,
    #[serde(default)]
    pub last_picture_update: i64,
    #[serde(default)]
    pub props: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub notify_props: std::collections::HashMap<String, String>,
}

impl User {
    pub fn display_name(&self) -> String {
        let full = [self.first_name.trim(), self.last_name.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if !full.is_empty() {
            full
        } else if !self.nickname.trim().is_empty() {
            self.nickname.trim().to_owned()
        } else if !self.username.trim().is_empty() {
            self.username.trim().to_owned()
        } else {
            self.id.clone()
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub team_id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing)]
    pub members: Vec<String>,
    #[serde(default)]
    pub last_post_at: i64,
    #[serde(default, skip_serializing)]
    pub muted: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChannelUnread {
    pub channel_id: String,
    #[serde(default)]
    pub msg_count: u64,
    #[serde(default)]
    pub mention_count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Post {
    pub id: String,
    pub channel_id: String,
    pub user_id: String,
    pub message: String,
    pub create_at: i64,
    #[serde(default)]
    pub update_at: i64,
    #[serde(default)]
    pub delete_at: i64,
    #[serde(default)]
    pub pending_post_id: String,
    #[serde(default)]
    pub root_id: String,
    #[serde(default)]
    pub metadata: PostMetadata,
    #[serde(default, rename = "type")]
    pub type_: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub props: Option<Poll>,
}

impl Post {
    pub fn poll(&self) -> Option<&Poll> {
        if self.type_ == POLL_POST_TYPE {
            self.props.as_ref()
        } else {
            None
        }
    }
}

pub const POLL_POST_TYPE: &str = "custom_matterpoll";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Poll {
    #[serde(default, rename = "poll_id")]
    pub poll_id: String,
    #[serde(default)]
    pub attachments: Vec<PollAttachment>,
}

impl Poll {
    pub fn attachment(&self) -> Option<&PollAttachment> {
        self.attachments.first()
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct PollAttachment {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub actions: Vec<PollAction>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PollAction {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "type")]
    pub kind: String,
}

impl PollAction {
    fn split_count(&self) -> (&str, Option<u64>) {
        let Some(open) = self
            .name
            .strip_suffix(')')
            .and_then(|rest| rest.rfind(" ("))
        else {
            return (&self.name, None);
        };
        let digits = &self.name[open + 2..self.name.len() - 1];
        match digits.parse::<u64>() {
            Ok(count) if digits.bytes().all(|b| b.is_ascii_digit()) => {
                (&self.name[..open], Some(count))
            }
            _ => (&self.name, None),
        }
    }

    pub fn option(&self) -> &str {
        self.split_count().0
    }

    pub fn vote_count(&self) -> Option<u64> {
        self.split_count().1
    }

    pub fn is_vote(&self) -> bool {
        self.kind == "button" && self.id.starts_with("vote") && self.id != "resetVote"
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct PostMetadata {
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    #[serde(default)]
    pub files: Vec<FileInfo>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct FileInfo {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub extension: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mime_type: String,
}

impl FileInfo {
    pub fn is_image(&self) -> bool {
        self.mime_type.starts_with("image/")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CustomEmoji {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Reaction {
    pub user_id: String,
    pub emoji_name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Thread {
    pub id: String,
    pub post: Post,
    #[serde(default)]
    pub unread_replies: u64,
    #[serde(default)]
    pub unread_mentions: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ThreadPage {
    #[serde(default)]
    pub threads: Vec<Thread>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PostPage {
    pub order: Vec<String>,
    pub posts: std::collections::HashMap<String, Post>,
    pub prev_post_id: Option<String>,
    pub has_next: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct FileSearch {
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub file_infos: std::collections::HashMap<String, FileInfo>,
}

#[derive(Clone, Serialize)]
pub struct CreatePost {
    pub channel_id: String,
    pub message: String,
    pub pending_post_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub file_ids: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub root_id: String,
}
