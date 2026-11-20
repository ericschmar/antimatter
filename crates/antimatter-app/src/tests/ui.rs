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
    assert!(!inert(&rt, "draft"));
    assert!(inert(&rt, "send"));
}

#[test]
fn gif_picker_button_is_present_and_enabled_when_a_key_is_set() {
    let mut s = State::default();
    synthetic_workspace(&mut s);
    s.giphy_key = Some("key".into());
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
    assert!(!inert(&rt, "gif-picker-open"));
}

#[test]
fn gif_picker_button_is_inert_without_a_key() {
    let mut s = State::default();
    synthetic_workspace(&mut s);
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
    assert!(inert(&rt, "gif-picker-open"));
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
    assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "keep text"));
    assert!(!rt.state.ready);
    assert!(rt.state.pending.is_none());
    assert_eq!(rt.state.draft.text, "keep text");
    tap(&mut rt, "draft");
    rt.paste("late edit");
    rt.invalidate();
    rt.frame(0.0);
    assert!(!inert(&rt, "draft"));
    assert!(inert(&rt, "send"));
    tap(&mut rt, "send");
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
fn switching_back_restores_the_cached_members_before_refresh() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.members = vec!["u1".into(), "u2".into()];
    rt.state.load("other".into());
    assert!(rt.state.members.is_empty());
    rt.state.apply(Update::Members {
        channel_id: "other".into(),
        user_ids: vec!["u3".into()],
        names: HashMap::new(),
    });
    rt.state.ready = true;
    rt.state.load("c".into());
    assert_eq!(rt.state.members, vec!["u1".to_owned(), "u2".to_owned()]);
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
fn confirming_a_delete_dispatches_delete_for_that_post() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    let post = post("sent");
    rt.state.open_delete(&post);
    assert!(rt.state.deleting.is_some());
    rt.state.confirm_delete();
    assert!(matches!(
        intents.try_recv(),
        Ok(Intent::Delete(channel, id)) if channel == "c" && id == "sent"
    ));
    assert!(rt.state.deleting.is_none());
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
        muted: false,
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
fn channel_and_dm_menus_offer_mute_or_unmute_from_the_muted_flag() {
    let mut rt = synthetic_runtime();
    rt.state.channels.push(Channel {
        id: "dm-peer".into(),
        team_id: String::new(),
        name: "me__peer".into(),
        display_name: "Peer".into(),
        kind: "D".into(),
        members: Vec::new(),
        last_post_at: 0,
        muted: true,
    });
    rt.invalidate();
    rt.frame(0.0);
    let (x, y) = rt.find("channel-synthetic-other").unwrap();
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(0.0);
    for _ in 0..120 {
        rt.frame(1.0 / 120.0);
    }
    let labels = |rt: &Runtime<State>| -> Vec<String> {
        rt.elements()
            .iter()
            .filter_map(|e| e.label.clone())
            .collect()
    };
    assert!(labels(&rt).iter().any(|l| l == "Mute"));
    assert!(!labels(&rt).iter().any(|l| l == "Unmute"));
    rt.state.channel_menu = None;
    rt.invalidate();
    rt.frame(0.0);
    let (x, y) = rt.find("channel-dm-peer").unwrap();
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rt.frame(0.0);
    for _ in 0..120 {
        rt.frame(1.0 / 120.0);
    }
    assert!(labels(&rt).iter().any(|l| l == "Unmute"));
    assert!(!labels(&rt).iter().any(|l| l == "Mute"));
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
            muted: false,
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
        type_: String::new(),
        props: None,
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
            type_: String::new(),
            props: None,
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
fn a_pending_jump_pages_older_history_until_its_post_loads() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = true;
    rt.state.has_older = true;
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
        type_: String::new(),
        props: None,
    };
    rt.state.posts = vec![at("new", 200)];
    rt.state.focus_post = Some(("c".into(), "old".into()));
    rt.update(|s, tx| s.reveal_focus_post(tx));
    assert!(matches!(intents.try_recv(), Ok(Intent::Older)));
    assert_eq!(rt.state.focus_post, Some(("c".into(), "old".into())));
    rt.state.apply(Update::Older {
        channel_id: "c".into(),
        posts: vec![at("old", 100)],
        names: HashMap::new(),
        has_older: false,
    });
    rt.update(|s, tx| s.reveal_focus_post(tx));
    assert_eq!(rt.state.focus_post, None);
    assert!(intents.try_recv().is_err());
}

#[test]
fn a_pending_jump_with_no_older_history_gives_up() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = true;
    rt.state.has_older = false;
    rt.state.focus_post = Some(("c".into(), "gone".into()));
    rt.update(|s, tx| s.reveal_focus_post(tx));
    assert_eq!(rt.state.focus_post, None);
    assert!(intents.try_recv().is_err());
}

#[test]
fn a_pending_jump_for_another_channel_never_pages_this_one() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.ready = true;
    rt.state.has_older = true;
    rt.state.focus_post = Some(("other".into(), "far".into()));
    rt.update(|s, tx| s.reveal_focus_post(tx));
    assert!(intents.try_recv().is_err());
    assert_eq!(rt.state.focus_post, Some(("other".into(), "far".into())));
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

#[test]
fn composer_keeps_focus_through_send_and_acknowledgement() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.draft.text = "hello".into();
    rt.invalidate();
    rt.frame(0.0);
    tap(&mut rt, "draft");
    rt.state.ready = true;
    tap(&mut rt, "send");
    rt.invalidate();
    rt.frame(0.0);
    let focused = |rt: &Runtime<State>| {
        rt.elements()
            .iter()
            .find(|e| e.key.as_deref() == Some("input"))
            .unwrap()
            .focused
    };
    assert!(rt.state.submitted);
    assert!(focused(&rt));
    rt.state.apply(Update::Pending(Some(pending())));
    rt.state.apply(Update::Pending(None));
    rt.invalidate();
    rt.frame(0.0);
    assert!(!rt.state.submitted);
    assert!(focused(&rt));
}

#[test]
fn gif_post_draws_its_picture_once_the_store_has_it() {
    let url = "https://media4.giphy.com/media/v1.abc/l0/giphy.gif";
    let mut s = State::default();
    synthetic_workspace(&mut s);
    let mut post = s.posts[0].clone();
    post.id = "gif-post".into();
    post.message = format!("![Bored]({url})");
    s.posts = vec![post];
    s.gifs.attach(std::sync::Arc::new(|| {}));
    s.gifs.finish(
        url.into(),
        Some(include_bytes!("fixtures/gif-2x2.gif").to_vec()),
    );
    for _ in 0..200 {
        if s.gifs.get(url).is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
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
    let picture = rt
        .elements()
        .into_iter()
        .find(|e| e.role == "image" && e.label.as_deref() == Some("Bored"))
        .expect("GIF drawn as a picture");
    assert!(picture.rect[3] > 19.0, "picture, not the alt-text line");
}

#[test]
fn single_image_file_draws_its_picture_in_the_ledger() {
    let mut s = State::default();
    synthetic_workspace(&mut s);
    let file = antimatter_services::mattermost::FileInfo {
        id: "single-file".into(),
        name: "photo.gif".into(),
        mime_type: "image/gif".into(),
        ..Default::default()
    };
    let mut post = s.posts[0].clone();
    post.id = "single-image-post".into();
    post.message = String::new();
    post.metadata.files = vec![file];
    s.posts = vec![post];
    s.gifs.attach(std::sync::Arc::new(|| {}));
    s.gifs.finish(
        "file:single-file".into(),
        Some(include_bytes!("fixtures/gif-2x2.gif").to_vec()),
    );
    for _ in 0..200 {
        if s.gifs.get("file:single-file").is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
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
    assert!(
        rt.elements()
            .iter()
            .any(|e| e.role == "image" && e.label.as_deref() == Some("photo.gif")),
        "single image drawn inline"
    );
}

fn thread_post(id: &str, root: &str, create_at: i64) -> Post {
    Post {
        id: id.into(),
        channel_id: "c".into(),
        user_id: "u".into(),
        message: format!("message {id}"),
        create_at,
        update_at: create_at,
        delete_at: 0,
        pending_post_id: String::new(),
        root_id: root.into(),
        metadata: Default::default(),
        type_: String::new(),
        props: None,
    }
}

#[test]
fn thread_button_opens_the_side_panel_for_the_posts_root() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.posts = vec![
        thread_post("root", "", 100),
        thread_post("reply", "root", 200),
    ];
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.find("thread-panel").is_none());
    let post = rt.state.posts[1].clone();
    rt.state.open_thread_pane(&post);
    assert!(matches!(intents.try_recv(), Ok(Intent::Thread(root)) if root == "root"));
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.find("thread-panel").is_some());
    assert!(rt.find("thread-draft").is_some());
    assert!(rt.find("thread-send").is_some());
    let ids: Vec<_> = rt
        .state
        .thread
        .as_ref()
        .unwrap()
        .posts
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    assert_eq!(ids, ["root", "reply"]);
    tap(&mut rt, "thread-close");
    assert!(rt.state.thread.is_none());
}

#[test]
fn matterpoll_post_renders_its_options_and_records_the_vote_locally() {
    let mut rt = synthetic_runtime();
    let poll: antimatter_services::mattermost::Post = serde_json::from_value(serde_json::json!({
        "id": "poll-post",
        "channel_id": "c",
        "user_id": "u",
        "message": "",
        "create_at": 1,
        "type": "custom_matterpoll",
        "props": {
            "poll_id": "poll-1",
            "attachments": [{
                "title": "Lunch?",
                "text": "",
                "actions": [
                    {"id": "vote0", "name": "Pizza (2)", "type": "button"},
                    {"id": "vote1", "name": "Tacos (1)", "type": "button"}
                ]
            }]
        }
    }))
    .unwrap();
    rt.state.posts = vec![poll];
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.find("poll-poll-post").is_some());
    assert!(rt.find("poll-option-poll-post-vote0").is_some());
    assert!(rt.find("poll-option-poll-post-vote1").is_some());
    rt.state
        .poll_votes
        .insert("poll-post".into(), "vote0".into());
    assert_eq!(
        rt.state.poll_votes.get("poll-post").map(String::as_str),
        Some("vote0")
    );
}

#[test]
fn only_the_poll_creator_sees_end_poll_and_it_confirms_first() {
    let mut rt = synthetic_runtime();
    rt.state.authenticated = Some(saved_key("me"));
    let poll = |author: &str| -> antimatter_services::mattermost::Post {
        serde_json::from_value(serde_json::json!({
            "id": format!("poll-by-{author}"),
            "channel_id": "c",
            "user_id": author,
            "message": "",
            "create_at": 1,
            "type": "custom_matterpoll",
            "props": {
                "poll_id": "poll-1",
                "attachments": [{
                    "title": "Lunch?",
                    "text": "",
                    "actions": [{"id": "vote0", "name": "Pizza", "type": "button"}]
                }]
            }
        }))
        .unwrap()
    };
    rt.state.posts = vec![poll("other"), poll("me")];
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.find("poll-end-poll-by-other").is_none());
    assert!(rt.find("poll-end-poll-by-me").is_some());
    assert!(rt.find("end-poll-confirm").is_none());
    tap(&mut rt, "poll-end-poll-by-me");
    assert_eq!(rt.state.ending_poll.as_deref(), Some("poll-by-me"));
    assert!(rt.find("end-poll-confirm").is_some());
    tap(&mut rt, "end-poll-cancel");
    assert!(rt.state.ending_poll.is_none());
}

#[test]
fn create_poll_dialog_validates_before_any_request() {
    let mut rt = synthetic_runtime();
    rt.state.channel = Some("c".into());
    tap(&mut rt, "create-poll");
    assert!(rt.state.creating_poll);
    assert!(rt.find("poll-question").is_some());
    tap(&mut rt, "poll-create");
    assert!(rt.state.creating_poll);
    assert!(!rt.state.poll_busy);
    assert_eq!(
        rt.state.poll_error.as_deref(),
        Some("A poll needs a question and at least two options.")
    );
    rt.state.close_create_poll();
    assert!(!rt.state.creating_poll);
}

#[test]
fn thread_posts_for_another_root_or_channel_are_dropped() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.posts = vec![thread_post("root", "", 100)];
    let post = rt.state.posts[0].clone();
    rt.state.open_thread_pane(&post);
    rt.state.apply(Update::ThreadPosts {
        root_id: "other".into(),
        channel_id: "c".into(),
        posts: vec![thread_post("x", "other", 1)],
        names: HashMap::new(),
    });
    rt.state.apply(Update::ThreadPosts {
        root_id: "root".into(),
        channel_id: "elsewhere".into(),
        posts: vec![thread_post("y", "root", 1)],
        names: HashMap::new(),
    });
    assert_eq!(rt.state.thread.as_ref().unwrap().posts.len(), 1);
    rt.state.apply(Update::ThreadPosts {
        root_id: "root".into(),
        channel_id: "c".into(),
        posts: vec![thread_post("root", "", 100), thread_post("r", "root", 200)],
        names: HashMap::new(),
    });
    assert_eq!(rt.state.thread.as_ref().unwrap().posts.len(), 2);
    rt.state
        .apply(Update::Upsert(thread_post("r2", "root", 300)));
    rt.state
        .apply(Update::Upsert(thread_post("unrelated", "", 400)));
    assert_eq!(rt.state.thread.as_ref().unwrap().posts.len(), 3);
}

#[test]
fn thread_reply_locks_immediately_and_carries_the_root() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.posts = vec![thread_post("root", "", 100)];
    let post = rt.state.posts[0].clone();
    rt.state.open_thread_pane(&post);
    let _ = intents.try_recv();
    rt.state.draft.text = "main draft".into();
    rt.state.thread_draft.text = "in thread".into();
    rt.invalidate();
    rt.frame(0.0);
    tap(&mut rt, "thread-send");
    assert!(matches!(
        intents.try_recv(),
        Ok(Intent::Reply(root, message)) if root == "root" && message == "in thread"
    ));
    assert!(!rt.state.ready);
    assert!(rt.state.submitted);
    assert_eq!(rt.state.draft.text, "main draft");
    assert_eq!(rt.state.thread_draft.text, "in thread");
    rt.invalidate();
    rt.frame(0.0);
    assert!(inert(&rt, "thread-send"));
    assert!(!inert(&rt, "thread-draft"));
    rt.state.send_thread();
    assert!(intents.try_recv().is_err());
    rt.state.apply(Update::Pending(Some(Pending {
        post: mattermost::CreatePost {
            channel_id: "c".into(),
            message: "in thread".into(),
            pending_post_id: "p".into(),
            file_ids: vec![],
            root_id: "root".into(),
        },
        failed: false,
        retryable: false,
    })));
    rt.state.apply(Update::Pending(None));
    assert!(!rt.state.submitted);
    assert!(rt.state.thread_draft.text.is_empty());
    assert_eq!(rt.state.draft.text, "main draft");
}

#[test]
fn failed_thread_enqueue_keeps_the_draft_and_unlocked_state() {
    let (sender, intents) = mpsc::channel(1);
    let mut rt = ui(sender.clone());
    rt.state.posts = vec![thread_post("root", "", 100)];
    let post = rt.state.posts[0].clone();
    rt.state.open_thread_pane(&post);
    rt.state.thread_draft.text = "in thread".into();
    sender.try_send(Intent::Active).ok();
    rt.state.send_thread();
    assert!(!rt.state.submitted);
    assert!(rt.state.ready);
    assert_eq!(rt.state.thread_draft.text, "in thread");
    drop(intents);
}

#[test]
fn switching_channels_closes_the_thread_panel() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.posts = vec![thread_post("root", "", 100)];
    let post = rt.state.posts[0].clone();
    rt.state.open_thread_pane(&post);
    rt.state.load_now("other".into());
    assert!(rt.state.thread.is_none());
}

#[test]
fn search_filters_panel_opens_from_the_search_row_and_keeps_stable_keys() {
    let mut rt = synthetic_runtime();
    let has = |rt: &Runtime<State>, key: &str| {
        rt.elements().iter().any(|e| e.key.as_deref() == Some(key))
    };
    assert!(!has(&rt, "search-filter-scope"));
    tap(&mut rt, "search-filters-toggle");
    rt.invalidate();
    rt.frame(0.0);
    assert!(rt.state.search_filters_open);
    for key in [
        "search-filter-scope",
        "search-filter-channel",
        "search-filter-sender",
        "search-filter-after",
        "search-filter-before",
        "search-filter-files",
        "search-filter-pinned",
        "search-filter-saved",
        "search-filter-extension",
    ] {
        assert!(has(&rt, key), "missing {key}");
    }
    tap(&mut rt, "segment2");
    assert_eq!(
        rt.state.search_filters.thread_scope,
        antimatter_services::mattermost::ThreadScope::Replies
    );
    tap(&mut rt, "search-filter-pinned");
    assert!(rt.state.search_filters.pinned_only);
    tap(&mut rt, "search-filter-pinned");
    assert!(!rt.state.search_filters.pinned_only);
    tap(&mut rt, "search-filters-toggle");
    assert!(!rt.state.search_filters_open);
    for _ in 0..60 {
        rt.frame(1.0 / 60.0);
    }
    assert!(!has(&rt, "search-filter-scope"));
}

#[test]
fn the_composer_does_not_fly_in_when_a_send_is_acknowledged() {
    let (sender, _intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.draft.text = "keep text".into();
    rt.invalidate();
    for _ in 0..60 {
        rt.frame(1.0 / 60.0);
    }
    let rect = |rt: &Runtime<State>| {
        rt.elements()
            .iter()
            .find(|e| e.key.as_deref() == Some("draft"))
            .unwrap()
            .rect
    };
    let rest = rect(&rt);
    rt.state.apply(Update::Pending(Some(pending())));
    rt.invalidate();
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
    }
    assert_eq!(rect(&rt), rest);
    rt.state.apply(Update::Pending(None));
    rt.invalidate();
    for _ in 0..30 {
        rt.frame(1.0 / 60.0);
        assert_eq!(rect(&rt), rest);
    }
}

#[test]
fn the_caret_is_hidden_while_the_window_is_unfocused() {
    let mut s = State::default();
    let ink = rune::Color::WHITE;
    assert_eq!(s.caret(ink), ink);
    s.caret_on = false;
    assert_eq!(s.caret(ink), rune::Color::TRANSPARENT);
    s.caret_on = true;
    s.window_focused = false;
    assert_eq!(s.caret(ink), rune::Color::TRANSPARENT);
}
