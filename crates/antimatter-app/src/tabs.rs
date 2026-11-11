use crate::state::*;
use crate::theme::workspace_theme;
use antimatter_services::accounts::MAX_TABS;
use rune::{El, Icon, el};
use rune_kit::{
    MenuItem,
    shell::{TabItem, TabItemStatus, TabOrientation, TabOverflow, TabStrip},
};

static CHANNEL: Icon = Icon {
    name: "antimatter-channel",
    view: 16.0,
    body: r#"<path d="M6.5 3L5.5 13" stroke="currentColor"/><path d="M10.5 3L9.5 13" stroke="currentColor"/><path d="M3 6H13" stroke="currentColor"/><path d="M3 10H12.5" stroke="currentColor"/>"#,
};

const TAB_MIN: f32 = 72.0;
const TAB_MAX: f32 = 240.0;
const TAB_CHROME: f32 = 76.0;
const TAB_GLYPH: f32 = 8.0;

fn tab_width(titles: impl Iterator<Item = usize>) -> f32 {
    let longest = titles.max().unwrap_or(0) as f32;
    (longest * TAB_GLYPH + TAB_CHROME).clamp(TAB_MIN * 2.0, TAB_MAX)
}

impl State {
    /// Durable tabs in strip order, then the single temporary preview tab.
    pub(crate) fn tab_order(&self) -> Vec<String> {
        let mut order = self.navigation.tabs.clone();
        if let Some(preview) = &self.preview
            && !order.contains(preview)
        {
            order.insert(self.preview_at.min(order.len()), preview.clone());
        }
        order
    }

    pub(crate) fn can_switch(&self) -> bool {
        self.ready
            && !self.busy
            && !self.submitted
            && self.pending.is_none()
            && !self.recovered_pending
            && self.checkpoint_retry.is_none()
            && (self.durable.is_some() || self.draft.text.is_empty())
    }

    pub(crate) fn note_open(&mut self, channel: &str) {
        if !self.navigation.tabs.iter().any(|id| id == channel) {
            if self.preview.is_none() {
                self.preview_at = self.navigation.tabs.len();
            }
            self.preview = Some(channel.to_owned());
        }
    }

    pub(crate) fn keep_tab(&mut self, channel: &str) {
        if self.navigation.tabs.iter().any(|id| id == channel)
            || self.navigation.tabs.len() >= MAX_TABS
            || !self.channels.iter().any(|c| c.id == channel)
        {
            return;
        }
        if self.preview.as_deref() == Some(channel) {
            let at = self.preview_at.min(self.navigation.tabs.len());
            self.navigation.tabs.insert(at, channel.to_owned());
            self.preview = None;
        } else {
            self.navigation.tabs.push(channel.to_owned());
        }
    }

    pub(crate) fn open_durable(&mut self, channel: String) {
        if self.channel.as_deref() == Some(&channel) {
            self.keep_tab(&channel);
        } else if self.can_switch() {
            self.keep_tab(&channel);
            self.load(channel);
        }
    }

    pub(crate) fn close_tab(&mut self, id: &str) {
        let order = self.tab_order();
        let Some(index) = order.iter().position(|t| t == id) else {
            return;
        };
        if order.len() < 2 {
            return;
        }
        if self.channel.as_deref() == Some(id) {
            if !self.can_switch() {
                return;
            }
            let next = order[if index + 1 < order.len() {
                index + 1
            } else {
                index - 1
            }]
            .clone();
            self.remove_tab(id);
            self.load(next);
        } else {
            self.remove_tab(id);
        }
    }

    pub(crate) fn close_other_tabs(&mut self, keep: &str) {
        if !self.tab_order().iter().any(|t| t == keep) {
            return;
        }
        if self.channel.as_deref() != Some(keep) {
            if !self.can_switch() {
                return;
            }
            self.load(keep.to_owned());
        }
        self.navigation.tabs.retain(|t| t == keep);
        if self.preview.as_deref() != Some(keep) {
            self.preview = None;
        }
    }

    fn remove_tab(&mut self, id: &str) {
        self.navigation.tabs.retain(|t| t != id);
        if self.preview.as_deref() == Some(id) {
            self.preview = None;
        }
    }

    pub(crate) fn reorder_tab(&mut self, from: usize, to: usize) {
        let mut order = self.tab_order();
        if from >= order.len() || to >= order.len() || from == to {
            return;
        }
        let tab = order.remove(from);
        order.insert(to, tab);
        if let Some(preview) = &self.preview
            && let Some(at) = order.iter().position(|t| t == preview)
        {
            self.preview_at = at;
            order.remove(at);
        }
        self.navigation.tabs = order;
    }

    pub(crate) fn prune_tabs(&mut self) {
        if !self.channels.is_empty() {
            let known: Vec<_> = self.channels.iter().map(|c| c.id.clone()).collect();
            self.navigation.tabs.retain(|t| known.contains(t));
        }
    }
}

pub(crate) fn window_key(s: &mut State, key: &rune::KeyEvent, _: &mut rune::Tx) -> bool {
    if s.account.is_none() || !key.is_command('w') || key.mods.shift {
        return false;
    }
    if let Some(id) = s.channel.clone() {
        s.close_tab(&id);
    }
    true
}

pub(crate) fn tab_strip(s: &State, layer: &mut Vec<El>) -> El {
    let k = workspace_theme();
    let order = s.tab_order();
    let items = order.iter().map(|id| {
        let title = s
            .channels
            .iter()
            .find(|c| &c.id == id)
            .map_or("Channel", |c| c.display_name.as_str());
        let unread = s.unread.get(id).copied().unwrap_or_default();
        let status = if s.channel.as_deref() == Some(id) {
            None
        } else if unread.mentions > 0 {
            Some(TabItemStatus::Attention)
        } else if unread.messages > 0 {
            Some(TabItemStatus::Unread)
        } else {
            None
        };
        let preview = !s.navigation.tabs.contains(id);
        let menu = id.clone();
        TabItem::new(id.as_str(), title)
            .icon(&CHANNEL)
            .status(status)
            .closable(order.len() > 1)
            .decorate(move |tab, _| {
                let tab = tab.on_secondary_press(move |s: &mut State, p, _| {
                    s.tab_menu = Some((menu.clone(), p));
                });
                if preview {
                    tab.description("Preview tab")
                } else {
                    tab
                }
            })
    });
    let width = tab_width(order.iter().map(|id| {
        s.channels
            .iter()
            .find(|c| &c.id == id)
            .map_or(7, |c| c.display_name.chars().count())
    }));
    let strip = TabStrip::new("tabs", TabOrientation::Horizontal)
        .overflow(TabOverflow::ShrinkThenScroll {
            min_width: TAB_MIN,
            max_width: width,
            pinned_width: 36.0,
            fade_width: 24.0,
        })
        .tabs(items)
        .active(s.channel.as_deref())
        .viewport_width(rune::memo::layout_size("tabs").map(|z| z[0]))
        .drag_state(&s.tab_drag, |s: &mut State| &mut s.tab_drag)
        .label("Conversation tabs")
        .on_select(|s: &mut State, id, _| {
            if s.channel.as_deref() != Some(id) {
                s.load(id.to_owned());
            }
        })
        .on_close(|s: &mut State, id, _| s.close_tab(id))
        .on_double_click(|s: &mut State, id, _| s.keep_tab(id))
        .on_reorder(|s: &mut State, r, _| s.reorder_tab(r.from, r.to))
        .build(&k);
    let point = s.tab_menu.clone();
    let id = point.as_ref().map(|(id, _)| id.clone()).unwrap_or_default();
    let durable = s.navigation.tabs.contains(&id);
    let menu = rune_kit::context_menu("tab-menu", el().w(0.0).h(0.0), point.map(|(_, p)| p))
        .on_close(|s: &mut State| s.tab_menu = None)
        .item({
            let id = id.clone();
            MenuItem::new("Close tab").on_select(move |s: &mut State| {
                s.tab_menu = None;
                s.close_tab(&id);
            })
        })
        .item({
            let id = id.clone();
            MenuItem::new("Close other tabs").on_select(move |s: &mut State| {
                s.tab_menu = None;
                s.close_other_tabs(&id);
            })
        })
        .item({
            let id = id.clone();
            MenuItem::new("Keep tab open")
                .disabled(durable)
                .on_select(move |s: &mut State| {
                    s.tab_menu = None;
                    s.keep_tab(&id);
                })
        })
        .build(&k, layer);
    rune::row()
        .grow(1.0)
        .shrink()
        .min_w(0.0)
        .center_y()
        .child(strip)
        .child(menu)
}
