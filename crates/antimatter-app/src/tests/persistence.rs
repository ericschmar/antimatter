use super::*;

#[test]
fn saved_identity_never_adopts_another_user() {
    assert!(validate_identity(Some(&saved_key("u")), &saved_key("u")).is_ok());
    assert!(validate_identity(Some(&saved_key("u")), &saved_key("other")).is_err());
    assert!(validate_identity(None, &saved_key("other")).is_ok());
}

#[tokio::test]
async fn metadata_startup_never_reads_credentials_and_missing_restore_preserves_selection() {
    struct NoReads;
    impl accounts::CredentialStore for NoReads {
        fn get(&self, _: &AccountKey) -> accounts::Result<Option<Secret>> {
            panic!("startup read credentials")
        }
        fn save(&mut self, _: &AccountKey, _: &Secret) -> accounts::Result<()> {
            Ok(())
        }
        fn remove(&mut self, _: &AccountKey) -> accounts::Result<()> {
            Ok(())
        }
    }
    let root = TempRoot::new();
    let store = Persistence::open(root.0.clone(), NoReads).await.unwrap();
    let key = saved_key("u");
    store
        .save(
            key.clone(),
            "synthetic".into(),
            Secret::new("fake".into()).unwrap(),
        )
        .await
        .unwrap();
    store.select(Some(key.clone())).await.unwrap();
    assert_eq!(store.accounts().await.unwrap().len(), 1);
    assert_eq!(store.selected().await.unwrap(), Some(key));
    let empty_root = TempRoot::new();
    let empty = Persistence::open(empty_root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    assert!(
        authenticate(
            Login::Saved(saved_key("missing")),
            Some(empty),
            false,
            1,
            None
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn durable_marker_survives_restart_and_checkpoint_keeps_other_channels() {
    let root = TempRoot::new();
    let key = saved_key("u");
    let mut credentials = FakeCredentials::default();
    credentials
        .0
        .insert(key.clone(), Secret::new("fake".into()).unwrap());
    let store = Persistence::open(root.0.clone(), credentials)
        .await
        .unwrap();
    store
        .save(
            key.clone(),
            "synthetic".into(),
            Secret::new("fake".into()).unwrap(),
        )
        .await
        .unwrap();
    let drafts = vec![
        Draft {
            pane_id: SUBMITTED.into(),
            channel_id: "c".into(),
            text: "possibly sent".into(),
        },
        Draft {
            pane_id: "unknown".into(),
            channel_id: "other".into(),
            text: "retained".into(),
        },
    ];
    store
        .checkpoint(
            key.clone(),
            drafts.clone(),
            Navigation {
                channel_id: Some("c".into()),
                ..Navigation::default()
            },
        )
        .await
        .unwrap();
    drop(store);
    let mut credentials = FakeCredentials::default();
    credentials
        .0
        .insert(key.clone(), Secret::new("fake".into()).unwrap());
    let reopened = Persistence::open(root.0.clone(), credentials)
        .await
        .unwrap();
    let (_, restored, navigation) = reopened.restore(key).await.unwrap();
    assert_eq!(restored, drafts);
    assert_eq!(navigation.channel_id.as_deref(), Some("c"));
    assert!(restored.iter().all(|d| d.pane_id != COMPOSER));
}

#[test]
fn submitted_restore_is_not_an_ordinary_draft_and_blocks_switch_send_and_signout() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.durable = Some(saved_key("u"));
    rt.state.drafts = vec![
        Draft {
            pane_id: SUBMITTED.into(),
            channel_id: "c".into(),
            text: "keep text".into(),
        },
        Draft {
            pane_id: "unknown-pane".into(),
            channel_id: "unknown-channel".into(),
            text: "orphan".into(),
        },
    ];
    rt.state.draft.text = "keep text".into();
    rt.state.recovered_pending = true;
    assert_eq!(rt.state.snapshot(), rt.state.drafts);
    rt.state.send();
    rt.state.authenticate(Login::Saved(saved_key("other")));
    rt.state.sign_out(saved_key("u"));
    assert!(intents.try_recv().is_err());
    assert_eq!(rt.state.draft.text, "keep text");
    assert!(rt.state.error.is_some());
    assert_eq!(rt.state.durable, Some(saved_key("u")));
}

#[test]
fn failed_durable_checkpoint_retains_content_and_navigation() {
    let (sender, mut intents) = mpsc::channel(8);
    let mut rt = ui(sender);
    rt.state.durable = Some(saved_key("u"));
    rt.state.draft.text = "unsaved".into();
    rt.state.posts.push(post(""));
    rt.state
        .checkpoint(AfterCheckpoint::SignOut(saved_key("other")));
    assert_eq!(rt.state.channel.as_deref(), Some("c"));
    assert_eq!(rt.state.draft.text, "unsaved");
    assert_eq!(rt.state.posts, vec![post("")]);
    assert!(rt.state.error.is_some());
    assert!(intents.try_recv().is_err());
}

#[test]
fn close_before_send_completion_restores_ordinary_draft_without_dispatch() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    executor.block_on(async {
        while !rt.state.write_task.as_ref().unwrap().is_finished() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert_eq!(
            store.restore(key.clone()).await.unwrap().1[0].pane_id,
            SUBMITTED
        );
    });
    rt.state.close();
    let (_, drafts, navigation) = executor.block_on(store.restore(key)).unwrap();
    assert_eq!(
        drafts,
        vec![Draft {
            pane_id: COMPOSER.into(),
            channel_id: "c".into(),
            text: "keep text".into(),
        }]
    );
    assert_eq!(navigation.channel_id.as_deref(), Some("c"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn close_after_send_acceptance_keeps_marker() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    executor
        .block_on(rt.state.write_task.take().unwrap())
        .unwrap();
    let drafts = executor.block_on(store.restore(key.clone())).unwrap().1;
    rt.state.complete_checkpoint(
        AfterCheckpoint::Send("keep text".into()),
        drafts.clone(),
        Ok(None),
    );
    assert!(rt.state.submitted);
    rt.state.close();
    assert_eq!(executor.block_on(store.restore(key)).unwrap().1, drafts);
    assert_eq!(drafts[0].pane_id, SUBMITTED);
    assert!(matches!(intents.try_recv(), Ok(Intent::Send(message)) if message == "keep text"));
    assert!(intents.try_recv().is_err());
}

#[test]
fn empty_channel_switch_autosaves_navigation() {
    let executor = tokio::runtime::Runtime::new().unwrap();
    let (sender, mut intents) = mpsc::channel(8);
    let (_root, mut rt) = executor.block_on(durable_ui(sender));
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.load("other".into());
    executor
        .block_on(rt.state.write_task.take().unwrap())
        .unwrap();
    rt.state
        .complete_checkpoint(AfterCheckpoint::Load("other".into()), vec![], Ok(None));
    assert!(matches!(intents.try_recv(), Ok(Intent::Load(channel)) if channel == "other"));
    assert!(matches!(intents.try_recv(), Ok(Intent::Members(channel)) if channel == "other"));
    rt.state.autosave();
    assert!(rt.state.write_task.is_some());
    rt.state.close();
    let (_, drafts, navigation) = executor.block_on(store.restore(key)).unwrap();
    assert!(drafts.is_empty());
    assert_eq!(navigation.channel_id.as_deref(), Some("other"));
    assert!(intents.try_recv().is_err());
}

#[tokio::test]
async fn delayed_ack_completion_cannot_resurrect_marker_on_close() {
    let (sender, _intents) = mpsc::channel(8);
    let (_root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.submitted = true;
    rt.state.pending = Some(pending());
    rt.state.drafts = vec![Draft {
        pane_id: SUBMITTED.into(),
        channel_id: "c".into(),
        text: "keep text".into(),
    }];
    store
        .checkpoint(key.clone(), rt.state.drafts.clone(), Navigation::default())
        .await
        .unwrap();
    rt.state.apply(Update::Pending(None));
    let task = rt.state.write_task.take().unwrap();
    task.await.unwrap();
    assert!(rt.state.submitted);
    rt.state.close();
    assert!(store.restore(key).await.unwrap().1.is_empty());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn edit_autosaves_and_failed_enqueue_rolls_back_without_dispatch() {
    let (sender, mut intents) = mpsc::channel(1);
    sender.try_send(Intent::Refresh).unwrap();
    let (_root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    tap(&mut rt, "draft");
    rt.paste("keep text");
    rt.frame(0.0);
    assert_eq!(rt.state.draft.text, "keep text");
    rt.state.autosave();
    assert!(rt.state.busy);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key.clone()).await.unwrap().1;
    assert_eq!(saved[0].text, "keep text");
    rt.state
        .complete_checkpoint(AfterCheckpoint::Save, saved, Ok(None));
    rt.state.send();
    rt.state.write_task.take().unwrap().await.unwrap();
    let marker = store.restore(key.clone()).await.unwrap().1;
    assert_eq!(marker[0].pane_id, SUBMITTED);
    rt.state
        .complete_checkpoint(AfterCheckpoint::Send("keep text".into()), marker, Ok(None));
    assert!(rt.state.busy);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key).await.unwrap().1;
    assert_eq!(saved[0].pane_id, COMPOSER);
    rt.state
        .complete_checkpoint(AfterCheckpoint::Rollback, saved, Ok(None));
    assert!(!rt.state.recovered_pending);
    assert!(matches!(intents.try_recv(), Ok(Intent::Refresh)));
    assert!(intents.try_recv().is_err());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn checkpoint_io_error_never_dispatches_and_can_retry_rollback() {
    let (sender, mut intents) = mpsc::channel(8);
    let (root, mut rt) = durable_ui(sender).await;
    let store = rt.state.persistence.clone().unwrap();
    let key = rt.state.durable.clone().unwrap();
    let account = store.accounts().await.unwrap().remove(0);
    let path = root.0.join(account.local_id).join("drafts.json");
    std::fs::create_dir_all(&path).unwrap();
    rt.state.draft.text = "keep text".into();
    rt.state.send();
    rt.state.write_task.take().unwrap().await.unwrap();
    let marker = rt.state.drafts.clone();
    rt.state.complete_checkpoint(
        AfterCheckpoint::Send("keep text".into()),
        marker.clone(),
        Err(accounts::Error::Invalid("test")),
    );
    rt.state.write_task.take().unwrap().await.unwrap();
    rt.state.complete_checkpoint(
        AfterCheckpoint::Rollback,
        marker,
        Err(accounts::Error::Invalid("test")),
    );
    assert!(rt.state.checkpoint_retry.is_some());
    assert!(!rt.state.recovered_pending);
    assert!(intents.try_recv().is_err());
    std::fs::remove_dir(path).unwrap();
    let retry = rt.state.checkpoint_retry.take().unwrap();
    rt.state.checkpoint(retry);
    rt.state.write_task.take().unwrap().await.unwrap();
    let saved = store.restore(key).await.unwrap().1;
    assert_eq!(saved[0].pane_id, COMPOSER);
    assert_eq!(saved[0].text, "keep text");
    rt.state
        .complete_checkpoint(AfterCheckpoint::Rollback, saved, Ok(None));
    assert!(rt.state.checkpoint_retry.is_none());
    assert!(intents.try_recv().is_err());
    let runtime = rt.state.runtime.take().unwrap();
    tokio::task::spawn_blocking(move || drop(runtime))
        .await
        .unwrap();
}

#[tokio::test]
async fn session_only_signout_cancels_only_matching_authenticated_identity() {
    for matching in [true, false] {
        let (sender, _intents) = mpsc::channel(8);
        let (_root, mut rt) = durable_ui(sender).await;
        let store = rt.state.persistence.clone().unwrap();
        let key = rt.state.durable.take().unwrap();
        rt.state.authenticated = Some(if matching {
            key.clone()
        } else {
            saved_key("other")
        });
        rt.state.selected = Some(key.clone());
        let (generation, stop) = rt.state.scope.replace();
        let result = store.sign_out(key.clone()).await;
        rt.state.complete_sign_out(key, result);
        assert_eq!(*stop.borrow(), matching);
        assert_eq!(rt.state.scope.accepts(generation), !matching);
        assert_eq!(rt.state.account.is_none(), matching);
        let runtime = rt.state.runtime.take().unwrap();
        tokio::task::spawn_blocking(move || drop(runtime))
            .await
            .unwrap();
    }
}

#[test]
fn persistence_errors_remain_retryable_and_auth_commit_blocks_cancel() {
    let mut s = State::default();
    let (generation, stop) = s.scope.replace();
    s.auth_writing = true;
    s.clear_session();
    assert!(s.scope.accepts(generation));
    assert!(!*stop.borrow());
    s.authenticate(Login::Saved(saved_key("other")));
    assert!(s.scope.accepts(generation));
    s.complete_checkpoint(
        AfterCheckpoint::Rollback,
        vec![],
        Err(accounts::Error::Invalid("synthetic failure")),
    );
    assert!(s.checkpoint_retry.is_some());
    assert!(!s.recovered_pending);
    assert!(s.blocked());
}
