use super::*;

#[test]
fn synthetic_workspace_selection_and_lock_stay_local() {
    let mut s = State::default();
    synthetic_workspace(&mut s);
    assert_eq!(s.sidebar.width(), 264.0);
    assert_eq!(s.channels.len(), 4);
    s.load("synthetic-other".into());
    assert_eq!(s.channel.as_deref(), Some("synthetic-other"));
    assert!(s.posts.is_empty());
    assert!(s.intents.is_none());
    let before = s.channel.clone();
    s.submitted = true;
    s.load("synthetic-channel".into());
    assert_eq!(s.channel, before);
    let mut rt = Runtime::new(
        s,
        view,
        (640.0, 640.0),
        Env {
            system_dark: true,
            scale: 2.0,
        },
    );
    rt.invalidate();
    rt.frame(0.0);
    assert!(inert(&rt, "draft"));
    assert!(inert(&rt, "send"));
}

#[test]
fn send_tap_locks_composer_before_worker_acknowledges() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.draft.text = "keep text".into();
    rt.invalidate();
    rt.frame(0.0);
    assert!(!inert(&rt, "draft"));
    assert!(!inert(&rt, "send"));
    tap(&mut rt, "send");
    assert!(!rt.state.ready);
    assert!(rt.state.pending.is_none());
    assert_eq!(rt.state.draft.text, "keep text");
    tap(&mut rt, "draft");
    rt.paste("late edit");
    rt.invalidate();
    rt.frame(0.0);
    assert_eq!(rt.state.draft.text, "keep text");
    assert!(inert(&rt, "draft"));
    assert!(inert(&rt, "send"));
    tap(&mut rt, "send");
    assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "keep text"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn enter_in_the_composer_sends_and_shift_enter_breaks_the_line() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.draft.text = "hello".into();
    rt.invalidate();
    rt.frame(0.0);
    tap(&mut rt, "draft");
    rt.key(rune::KeyEvent {
        key: rune::Key::Enter,
        mods: rune::Mods {
            shift: true,
            ..rune::Mods::default()
        },
    });
    rt.frame(0.0);
    assert_eq!(rt.state.draft.text, "hello\n");
    assert!(intents.try_recv().is_err());
    rt.key(rune::KeyEvent {
        key: rune::Key::Enter,
        mods: rune::Mods::default(),
    });
    rt.frame(0.0);
    assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "hello\n"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn switching_back_restores_the_cached_ledger_before_refresh() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.posts = vec![post("a")];
    rt.state.has_older = true;
    rt.state.load("other".into());
    assert!(rt.state.posts.is_empty());
    rt.state.ready = true;
    rt.state.load("c".into());
    assert_eq!(rt.state.posts.len(), 1);
    assert!(rt.state.has_older);
}

#[test]
fn editing_a_message_dispatches_an_edit_not_a_new_send() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    let mut post = post("sent");
    post.message = "original".into();
    rt.state.begin_edit(&post);
    assert_eq!(rt.state.draft.text, "original");
    rt.state.draft = rune::TextEdit::new("revised");
    rt.state.ready = true;
    rt.state.send();
    assert!(matches!(
        intents.try_recv(),
        Ok(Intent::Edit(id, message)) if id == "sent" && message == "revised"
    ));
    assert!(rt.state.editing.is_none());
    assert!(intents.try_recv().is_err());
}

#[test]
fn cancelling_an_edit_clears_the_composer() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.begin_edit(&post("sent"));
    rt.state.cancel_edit();
    assert!(rt.state.editing.is_none());
    assert!(rt.state.draft.text.is_empty());
    assert!(intents.try_recv().is_err());
}

#[test]
fn composer_stays_editable_during_refresh_but_send_is_blocked() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = false;
    rt.state.draft.text = "typing".into();
    rt.invalidate();
    rt.frame(0.0);
    assert!(!inert(&rt, "draft"));
    tap(&mut rt, "send");
    assert!(intents.try_recv().is_err());
}

#[test]
fn pending_acknowledgement_does_not_unlock_refresh() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.draft.text = "keep text".into();
    rt.state.apply(Update::Pending(Some(pending())));
    rt.state.error = Some("Could not refresh conversation. Reload to try again.");
    tap(&mut rt, "reload");
    assert!(!rt.state.ready);
    rt.state.apply(Update::Pending(None));
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.state.draft.text.is_empty());
    assert!(rt.state.pending.is_none());
    assert!(!rt.state.ready);
    assert!(!inert(&rt, "draft"));
    rt.state.apply(Update::Ready(true));
    rt.invalidate();
    rt.frame(0.0);
    assert!(!inert(&rt, "draft"));
    assert!(!inert(&rt, "channel-other"));
}

#[test]
fn failed_enqueue_retains_channel_timeline_and_draft() {
    for closed in [false, true] {
        let (sender, mut intents) = mpsc::channel(1);
        if closed {
            intents.close();
        } else {
            sender.try_send(Intent::Refresh).unwrap();
        }
        let mut rt = ui(sender);
        rt.state.posts.push(post(""));
        tap(&mut rt, "channel-other");
        assert_eq!(rt.state.channel.as_deref(), Some("c"));
        assert_eq!(rt.state.posts, vec![post("")]);
        assert!(rt.state.ready);
        assert!(rt.state.error.is_some());
        tap(&mut rt, "reload");
        assert!(rt.state.ready);
        rt.state.draft.text = "keep text".into();
        tap(&mut rt, "send");
        assert_eq!(rt.state.draft.text, "keep text");
        assert!(rt.state.ready);
        assert!(rt.state.pending.is_none());
        assert_eq!(rt.state.channel.as_deref(), Some("c"));
        assert_eq!(rt.state.posts, vec![post("")]);
        assert!(!inert(&rt, "draft"));
        assert!(rt.state.error.is_some());
    }
}

#[test]
fn disconnect_rejects_late_updates_from_cancelled_scope() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    let (generation, stop) = rt.state.scope.replace();
    rt.state.draft.text = "keep text".into();
    rt.state.pending = Some(pending());
    rt.state.posts.push(post(""));
    assert!(!*stop.borrow());
    assert_eq!(rt.state.draft.text, "keep text");
    rt.state.pending = None;
    rt.state.checkpoint(AfterCheckpoint::Disconnect);
    assert!(*stop.borrow());
    assert!(!rt.state.scope.accepts(generation));
    let (replacement, _stop) = rt.state.scope.replace();
    for update in [
        Update::Pending(Some(pending())),
        Update::Upsert(post("")),
        Update::Ready(true),
    ] {
        if rt.state.scope.accepts(generation) {
            rt.state.apply(update);
        }
    }
    assert!(rt.state.scope.accepts(replacement));
    assert!(rt.state.account.is_none());
    assert!(rt.state.channel.is_none());
    assert!(rt.state.intents.is_none());
    assert!(rt.state.posts.is_empty());
    assert!(rt.state.pending.is_none());
    assert!(rt.state.draft.text.is_empty());
    assert!(!rt.state.ready);
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.find("send").is_none());
    assert!(rt.find("connect-pat").is_some());
}

#[test]
fn a_tap_flips_the_switch_and_the_knob_springs_across() {
    let env = Env {
        system_dark: true,
        scale: 2.0,
    };
    let mut rt = Runtime::new(State::default(), view, (320.0, 200.0), env);
    rt.invalidate();
    rt.frame(0.0);
    let knob_x = |rt: &Runtime<State>| rt.presented("knob").unwrap().0[0];
    let off = knob_x(&rt);
    let (x, y) = rt.find("switch").unwrap();
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    for _ in 0..6 {
        rt.frame(1.0 / 60.0);
    }
    assert!(rt.state.on);
    let mid = knob_x(&rt);
    for _ in 0..60 {
        rt.frame(1.0 / 60.0);
    }
    let on = knob_x(&rt);
    assert!(off < mid && mid < on);
    assert!((on - off - 16.0).abs() < 0.01);
}

#[test]
fn sidebar_select_reuses_one_preview_tab_and_double_click_keeps_it() {
    let mut rt = synthetic_runtime();
    assert_eq!(rt.state.tab_order(), ["synthetic-channel"]);
    tap(&mut rt, "channel-synthetic-other");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.preview.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-channel", "synthetic-other"]
    );
    rt.state.load("synthetic-channel".into());
    assert_eq!(rt.state.preview.as_deref(), Some("synthetic-other"));
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-channel", "synthetic-other"]
    );
    assert!(rt.state.preview.is_none());
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(rt.state.navigation.tabs.len(), 2);
    rt.invalidate();
    rt.frame(0.0);
    assert_eq!(tab_keys(&rt), ["t-synthetic-channel", "t-synthetic-other"]);
}

#[test]
fn sidebar_groups_regular_channels_before_direct_messages_and_collapses() {
    let mut rt = synthetic_runtime();
    rt.state.channels.push(Channel {
        id: "dm-peer".into(),
        team_id: String::new(),
        name: "me__peer".into(),
        display_name: "Peer".into(),
        kind: "D".into(),
        members: Vec::new(),
        last_post_at: 0,
    });
    rt.invalidate();
    rt.frame(0.0);
    let keys = |rt: &Runtime<State>| -> Vec<String> {
        rt.elements()
            .iter()
            .filter_map(|e| e.key.clone())
            .filter(|k| k.starts_with("channel-") || k == "channels" || k == "direct-messages")
            .collect()
    };
    let order = keys(&rt);
    let channels = order.iter().position(|k| k == "channels").unwrap();
    let dms = order.iter().position(|k| k == "direct-messages").unwrap();
    let dm = order.iter().position(|k| k == "channel-dm-peer").unwrap();
    assert!(channels < dms && dms < dm);
    assert!(
        order
            .iter()
            .position(|k| k == "channel-synthetic-other")
            .unwrap()
            < dms
    );
    rt.state.dms_collapsed = true;
    rt.invalidate();
    rt.frame(0.0);
    assert!(!keys(&rt).iter().any(|k| k == "channel-dm-peer"));
    assert!(keys(&rt).iter().any(|k| k == "direct-messages"));
}

#[test]
fn newest_direct_message_sorts_first() {
    let mut rt = synthetic_runtime();
    rt.state.dms_collapsed = false;
    for (id, at) in [("dm-old", 1), ("dm-new", 2)] {
        rt.state.channels.push(Channel {
            id: id.into(),
            team_id: String::new(),
            name: format!("me__{id}"),
            display_name: id.into(),
            kind: "D".into(),
            members: Vec::new(),
            last_post_at: at,
        });
    }
    rt.invalidate();
    rt.frame(0.0);
    let keys: Vec<String> = rt
        .elements()
        .iter()
        .filter_map(|e| e.key.clone())
        .filter(|k| k == "channel-dm-old" || k == "channel-dm-new")
        .collect();
    assert_eq!(keys, ["channel-dm-new", "channel-dm-old"]);
}

#[test]
fn tab_close_activates_neighbour_and_last_tab_cannot_close() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.close_tab("synthetic-other");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    rt.state.close_tab("synthetic-channel");
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
}

#[test]
fn tab_switch_obeys_send_and_draft_guards() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.state.submitted = true;
    rt.state.close_tab("synthetic-channel");
    rt.state.load("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    assert_eq!(rt.state.navigation.tabs.len(), 2);
    rt.state.submitted = false;
    rt.state.recovered_pending = true;
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
    rt.state.close_other_tabs("synthetic-other");
    assert_eq!(rt.state.navigation.tabs.len(), 2);
}

#[test]
fn each_tab_keeps_its_own_draft_across_switches() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.state.draft = rune::TextEdit::new("first");
    rt.state.load("synthetic-other".into());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert!(rt.state.draft.text.is_empty());
    rt.state.draft = rune::TextEdit::new("second");
    rt.state.load("synthetic-channel".into());
    assert_eq!(rt.state.draft.text, "first");
    rt.state.close_tab("synthetic-channel");
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.draft.text, "second");
}

#[test]
fn saved_account_edit_prefills_identity_and_keeps_prior_entry_until_verified() {
    let key = saved_key("u");
    let mut rt = Runtime::new(State::default(), view, (640.0, 640.0), Env::new(true, 1.0));
    rt.state.accounts = vec![accounts::Account {
        local_id: "local".into(),
        key: key.clone(),
        username: "saved-user".into(),
        login_method: Some(LoginMethod::Password),
        site_name: None,
    }];
    rt.state.begin_edit_account(key.clone());
    assert_eq!(rt.state.server.text, "https://example.test");
    assert_eq!(rt.state.login.text, "saved-user");
    assert_eq!(rt.state.method, 1);
    assert_eq!(rt.state.accounts.len(), 1);
    assert_eq!(rt.state.accounts[0].key, key);
    rt.state.cancel_edit_account();
    assert!(rt.state.editing_account.is_none());
    assert_eq!(rt.state.accounts.len(), 1);
}

#[test]
fn saved_account_rows_are_left_aligned_with_context_menu_actions() {
    let mut rt = Runtime::new(
        State {
            application: true,
            ..State::default()
        },
        view,
        (640.0, 640.0),
        Env::new(true, 1.0),
    );
    rt.state.accounts = vec![accounts::Account {
        local_id: "local".into(),
        key: saved_key("u"),
        username: "saved-user".into(),
        login_method: Some(LoginMethod::Password),
        site_name: None,
    }];
    rt.invalidate();
    rt.frame(0.0);
    let elements = rt.elements();
    assert!(
        elements
            .iter()
            .any(|e| e.key.as_deref() == Some("account-local"))
    );
    assert!(
        elements
            .iter()
            .any(|e| e.text.as_deref() == Some("saved-user"))
    );
    assert!(
        elements
            .iter()
            .any(|e| e.text.as_deref() == Some("https://example.test"))
    );
    let (x, y) = rt.find("account-local").unwrap();
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(0.0);
    for _ in 0..120 {
        rt.frame(1.0 / 120.0);
    }
    assert!(rt.find("account-menu-local-item0").is_some());
    assert!(rt.find("account-menu-local-item0").is_some());
    assert!(rt.find("account-menu-local-item1").is_some());
    let elements = rt.elements();
    assert!(elements.iter().any(|e| e.label.as_deref() == Some("Edit")));
    assert!(
        elements
            .iter()
            .any(|e| e.label.as_deref() == Some("Delete"))
    );
    assert!(
        elements
            .iter()
            .any(|e| e.text.as_deref() == Some("Password"))
    );
    assert!(!elements.iter().any(|e| {
        e.text
            .as_deref()
            .is_some_and(|t| t.contains("selection does not connect"))
    }));
}

#[test]
fn tab_context_actions_and_unread_status() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.invalidate();
    rt.frame(0.0);
    let other = rt
        .elements()
        .into_iter()
        .find(|e| e.key.as_deref() == Some("t-synthetic-other"))
        .unwrap();
    assert_eq!(other.label.as_deref(), Some("synthetic-other"));
    assert!(!other.item_selected);
    assert!(
        rt.elements()
            .iter()
            .any(|e| e.key.as_deref() == Some("t-synthetic-channel") && e.item_selected)
    );
    rt.state.close_other_tabs("synthetic-channel");
    assert_eq!(rt.state.navigation.tabs, ["synthetic-channel"]);
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-channel"));
}

#[test]
fn reorder_moves_durable_tabs_only() {
    let mut s = State::default();
    s.navigation.tabs = vec!["a".into(), "b".into(), "c".into()];
    s.reorder_tab(0, 2);
    assert_eq!(s.navigation.tabs, ["b", "c", "a"]);
    s.reorder_tab(0, 9);
    assert_eq!(s.navigation.tabs, ["b", "c", "a"]);
}

#[test]
fn cmd_w_closes_the_active_tab_and_never_the_window() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-channel".into());
    rt.state.open_durable("synthetic-other".into());
    rt.state.load("synthetic-channel".into());
    rt.on_key = Some(crate::tabs::window_key);
    let cmd = rune::Mods {
        cmd: true,
        ..rune::Mods::default()
    };
    rt.key(rune::KeyEvent {
        key: rune::Key::Command('w'),
        mods: cmd,
    });
    rt.frame(0.0);
    assert!(rt.shell_request.take().is_none());
    assert_eq!(rt.state.channel.as_deref(), Some("synthetic-other"));
    assert_eq!(rt.state.navigation.tabs, ["synthetic-other"]);
}

#[test]
fn tab_titles_size_the_strip_and_every_tab_has_icon_and_close() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-other".into());
    rt.invalidate();
    rt.frame(0.0);
    let els = rt.elements();
    let width = |key: &str| {
        els.iter()
            .find(|e| e.key.as_deref() == Some(key))
            .unwrap()
            .rect[2]
    };
    assert!(width("t-synthetic-channel") <= 240.0 && width("t-synthetic-channel") >= 72.0);
    assert!(els.iter().any(|e| e.label.as_deref() == Some("Close tab")));
    assert!(els.iter().any(|e| e.key.as_deref() == Some("icon")));
}

fn drag_tab(rt: &mut Runtime<State>, from: &str, to: &str) {
    rt.invalidate();
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
    }
    let (x, y) = rt.find(from).unwrap();
    let (tx, _) = rt.find(to).unwrap();
    rt.pointer_down(x, y);
    rt.frame(1.0 / 60.0);
    let steps = 12;
    for i in 1..=steps {
        rt.pointer_move(x + (tx - x) * i as f32 / steps as f32, y);
        rt.frame(1.0 / 60.0);
    }
    rt.pointer_up(tx, y);
    rt.frame(1.0 / 60.0);
    rt.invalidate();
    rt.frame(0.0);
}

#[test]
fn dragging_a_tab_reorders_and_keeps_the_order() {
    let mut rt = synthetic_runtime();
    rt.state.open_durable("synthetic-other".into());
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-channel", "synthetic-other"]
    );
    drag_tab(&mut rt, "t-synthetic-channel", "t-synthetic-other");
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-other", "synthetic-channel"]
    );
    assert_eq!(tab_keys(&rt), ["t-synthetic-other", "t-synthetic-channel"]);
}

#[test]
fn dragging_the_preview_tab_keeps_it_where_it_was_dropped() {
    let mut rt = synthetic_runtime();
    rt.state.preview = Some("synthetic-other".into());
    rt.state.preview_at = 1;
    drag_tab(&mut rt, "t-synthetic-other", "t-synthetic-channel");
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-other", "synthetic-channel"]
    );
    assert_eq!(tab_keys(&rt), ["t-synthetic-other", "t-synthetic-channel"]);
}

#[test]
fn preview_tab_made_durable_keeps_its_dragged_position() {
    let mut rt = synthetic_runtime();
    rt.state.preview = Some("synthetic-other".into());
    rt.state.preview_at = 0;
    assert_eq!(
        rt.state.tab_order(),
        ["synthetic-other", "synthetic-channel"]
    );
    rt.state.keep_tab("synthetic-other");
    assert_eq!(
        rt.state.navigation.tabs,
        ["synthetic-other", "synthetic-channel"]
    );
}

#[test]
fn composer_toggles_between_rendered_and_markdown_source() {
    let mut rt = synthetic_runtime();
    rt.state.draft = crate::markdown::from_markdown("a **b**\n- item");
    assert_eq!(rt.state.draft.text, "a b\nitem");
    rt.state.toggle_raw();
    assert_eq!(rt.state.source.text, "a **b**\n- item");
    rt.state.source = rune::TextEdit::new("*x*");
    assert_eq!(rt.state.markdown(), "*x*");
    rt.state.toggle_raw();
    assert_eq!(rt.state.draft.text, "x");
    assert_eq!(rt.state.markdown(), "*x*");
}

#[test]
fn toolbar_bold_formats_selection() {
    let mut rt = synthetic_runtime();
    rt.state.draft = crate::markdown::from_markdown("hello");
    tap(&mut rt, "draft");
    rt.state.draft.set_selection(0, 5);
    tap(&mut rt, "bold");
    assert_eq!(rt.state.markdown(), "**hello**");
}

#[test]
fn toolbar_at_caret_arms_style_and_keeps_focus() {
    let mut rt = synthetic_runtime();
    tap(&mut rt, "draft");
    tap(&mut rt, "bold");
    assert!(rt.state.draft.has_mark(&rune::Mark::Bold));
}

#[test]
fn older_history_prepends_once_and_respects_guards() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = true;
    let at = |id: &str, create_at: i64| Post {
        id: id.into(),
        channel_id: "c".into(),
        user_id: "u".into(),
        message: "m".into(),
        create_at,
        update_at: create_at,
        delete_at: 0,
        pending_post_id: String::new(),
        root_id: String::new(),
        metadata: Default::default(),
    };
    rt.state.posts = vec![at("new", 200)];
    rt.state.has_older = false;
    rt.state.load_older();
    assert!(intents.try_recv().is_err());
    rt.state.has_older = true;
    rt.state.submitted = true;
    rt.state.load_older();
    assert!(intents.try_recv().is_err());
    rt.state.submitted = false;
    rt.state.load_older();
    assert!(matches!(intents.try_recv(), Ok(Intent::Older)));
    assert!(!rt.state.ready);
    rt.state.apply(Update::Older {
        channel_id: "c".into(),
        posts: vec![at("old", 100), at("new", 200)],
        names: HashMap::new(),
        has_older: false,
    });
    let ids: Vec<_> = rt.state.posts.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["old", "new"]);
}

#[test]
fn message_spacing_sets_row_padding_in_order_with_medium_as_default() {
    use crate::workspace::post_padding;
    use antimatter_services::settings::MessageSpacing;
    assert!(post_padding(MessageSpacing::Small) < post_padding(MessageSpacing::Medium));
    assert!(post_padding(MessageSpacing::Medium) < post_padding(MessageSpacing::Large));
    assert_eq!(post_padding(MessageSpacing::default()), 8.0);
}

#[test]
fn scrolling_to_the_top_by_hand_requests_one_older_page() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = true;
    rt.state.has_older = true;
    rt.state.posts = (0..40)
        .map(|i| Post {
            id: format!("p{i}"),
            channel_id: "c".into(),
            user_id: "u".into(),
            message: "m".into(),
            create_at: 1_000 + i as i64,
            update_at: 0,
            delete_at: 0,
            pending_post_id: String::new(),
            root_id: String::new(),
            metadata: Default::default(),
        })
        .collect();
    let set = |s: &State, offset: f32, hand: bool| {
        s.ledger_offset
            .store(offset.to_bits(), std::sync::atomic::Ordering::Relaxed);
        s.ledger_hand_scrolled
            .store(hand, std::sync::atomic::Ordering::Relaxed);
    };
    set(&rt.state, 0.0, false);
    rt.invalidate();
    rt.frame(0.0);
    assert!(
        intents.try_recv().is_err(),
        "opening the channel never pages"
    );
    set(&rt.state, 0.0, true);
    rt.invalidate();
    rt.frame(0.0);
    assert!(matches!(intents.try_recv(), Ok(Intent::Older)));
    assert!(rt.state.loading_older);
    rt.invalidate();
    rt.frame(0.0);
    assert!(
        intents.try_recv().is_err(),
        "a loading page blocks a second request"
    );
    rt.state.apply(Update::Older {
        channel_id: "c".into(),
        posts: vec![],
        names: HashMap::new(),
        has_older: true,
    });
    assert!(!rt.state.loading_older);
    set(&rt.state, 300.0, true);
    rt.invalidate();
    rt.frame(0.0);
    assert!(
        intents.try_recv().is_err(),
        "scrolling away from the top never pages"
    );
    set(&rt.state, 0.0, false);
    rt.invalidate();
    rt.frame(0.0);
    assert!(
        intents.try_recv().is_err(),
        "prepend anchoring at the top is not a hand scroll"
    );
}

#[test]
fn reply_targets_the_post() {
    let mut s = State::default();
    let mut post: antimatter_services::mattermost::Post = serde_json::from_value(
        serde_json::json!({"id":"p","channel_id":"c","user_id":"u","message":"","create_at":0}),
    )
    .unwrap();
    post.message = "hello\nthere".into();
    s.quote_reply(&post);
    assert_eq!(s.reply_to.as_ref().map(|p| p.id.as_str()), Some("p"));
    assert_eq!(s.markdown(), "");
}
