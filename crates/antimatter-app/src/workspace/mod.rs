use crate::state::*;
use crate::tabs::tab_strip;
use crate::theme::workspace_theme;
use crate::widgets::*;
use antimatter_services::conversation::{Intent, ThreadPreview};
use antimatter_services::mattermost::{Channel, Post, Team};
use antimatter_services::settings::MessageSpacing;
use antimatter_theme::icons;
use rune::{El, Icon, TextEdit, TextStyle, col, el, icon, row as hbox, text};
use rune_kit::{
    Button, ButtonVariant, ControlSize, Highlight, IconButton, IconButtonVariant, Markdown,
    MarkdownStyle, MenuItem, ScrollBar, ScrollBarStyle, Select, SelectAppearance,
};

mod sidebar;
mod post;
mod emoji;
mod poll;
mod attachments;
mod dialogs;
mod compose;
mod layout;
mod thread_panel;

pub(crate) use layout::workspace;
#[cfg(test)]
pub(crate) use post::post_padding;
pub(crate) use attachments::{gif_sources, single_image};
use sidebar::*;
use post::*;
use emoji::*;
use poll::*;
use attachments::*;
use dialogs::*;
use compose::*;
use thread_panel::*;

pub(crate) const TITLEBAR: f32 = 40.0;
const TRAFFIC_LIGHTS: f32 = 84.0;
const SERVER_MAX_WIDTH: f32 = 160.0;
const MAIN_MIN: f32 = 248.0;
const SECTION_HEADER_HEIGHT: f32 = 24.0;
const ROW_GUTTER: f32 = 6.0;
const EMPTY_ART: &str = include_str!("../empty_art.txt");

static DISCLOSURE_OPEN: Icon = Icon {
    name: "antimatter-disclosure-open",
    view: 16.0,
    body: r#"<path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
static DISCLOSURE_CLOSED: Icon = Icon {
    name: "antimatter-disclosure-closed",
    view: 16.0,
    body: r#"<path d="M6 4L10 8L6 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

static TEXT_ALIGN_LEFT: Icon = Icon {
    name: "antimatter-text-align-left",
    view: 16.0,
    body: r#"<path d="M2.5 4H13.5M2.5 8H9.5M2.5 12H12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>"#,
};
static ARROW_ELBOW: Icon = Icon {
    name: "antimatter-arrow-elbow",
    view: 16.0,
    body: r#"<path d="M3 3V9C3 9.8 3.6 10.5 4.5 10.5H12M9 7.5L12.5 10.5L9 13.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
