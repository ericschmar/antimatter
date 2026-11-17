use super::*;
use std::collections::HashMap;

#[derive(Default)]
struct FakeCredentials {
    values: HashMap<AccountKey, String>,
    fail_save: bool,
    fail_remove: bool,
    fail_get: bool,
    saves: usize,
}
impl CredentialStore for FakeCredentials {
    fn get(&self, key: &AccountKey) -> Result<Option<Secret>> {
        if self.fail_get {
            return Err(Error::Credential(-1));
        }
        Ok(self
            .values
            .get(key)
            .map(|v| Secret::new(v.clone()).unwrap()))
    }
    fn save(&mut self, key: &AccountKey, token: &Secret) -> Result<()> {
        if self.fail_save {
            return Err(Error::Credential(-1));
        }
        self.saves += 1;
        self.values.insert(key.clone(), token.expose().to_owned());
        Ok(())
    }
    fn remove(&mut self, key: &AccountKey) -> Result<()> {
        if self.fail_remove {
            return Err(Error::Credential(-1));
        }
        self.values.remove(key);
        Ok(())
    }
}

struct TempRoot(PathBuf);
impl TempRoot {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("antimatter-accounts-test-{}", Uuid::new_v4()));
        ensure_dir(&root).unwrap();
        Self(root)
    }
    fn store(&self) -> AccountStore<FakeCredentials> {
        AccountStore::open(&self.0, FakeCredentials::default()).unwrap()
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn key(origin: &str, id: &str) -> AccountKey {
    AccountKey::validated(
        ServerOrigin::new(origin, true).unwrap().as_str().to_owned(),
        id.to_owned(),
    )
    .unwrap()
}
fn token(value: &str) -> Secret {
    Secret::new(value.to_owned()).unwrap()
}
fn draft(text: &str) -> Draft {
    Draft {
        pane_id: "pane".into(),
        channel_id: "channel".into(),
        text: text.into(),
    }
}

#[tokio::test]
async fn actor_roundtrip_isolation_selection_and_missing_secret() {
    let root = TempRoot::new();
    let actor = Persistence::open(root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    let a = key("https://example.test", "a");
    let b = key("https://example.test", "b");
    let c = key("https://example.test:8443", "a");
    assert_eq!(actor.selected().await.unwrap(), None);
    for (i, key) in [&a, &b, &c].into_iter().enumerate() {
        let (_, drafts, nav) = actor
            .save(key.clone(), "synthetic".into(), token("synthetic"))
            .await
            .unwrap();
        assert!(drafts.is_empty());
        assert_eq!(nav, Navigation::default());
        actor
            .checkpoint(
                key.clone(),
                vec![draft(&i.to_string())],
                Navigation {
                    channel_id: Some(i.to_string()),
                    ..Navigation::default()
                },
            )
            .await
            .unwrap();
    }
    actor.clone().select(Some(b.clone())).await.unwrap();
    for (i, key) in [&a, &b, &c].into_iter().enumerate() {
        let (secret, drafts, nav) = actor.restore(key.clone()).await.unwrap();
        assert_eq!(secret.expose(), "synthetic");
        assert_eq!(drafts, vec![draft(&i.to_string())]);
        assert_eq!(nav.channel_id, Some(i.to_string()));
    }
    assert_eq!(actor.sign_out(a).await.unwrap().len(), 2);
    assert_eq!(actor.selected().await.unwrap(), Some(b.clone()));
    actor.sign_out(b).await.unwrap();
    assert_eq!(actor.selected().await.unwrap(), None);
    actor.select(Some(c.clone())).await.unwrap();
    let reopened = Persistence::open(root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    assert_eq!(reopened.selected().await.unwrap(), Some(c.clone()));
    assert!(matches!(
        reopened.restore(c.clone()).await,
        Err(Error::Invalid(_))
    ));
    assert!(
        reopened
            .select(Some(key("https://example.test", "unknown")))
            .await
            .is_err()
    );
    assert_eq!(reopened.selected().await.unwrap(), Some(c));
}

#[tokio::test]
async fn favorites_persist_across_reopen() {
    let root = TempRoot::new();
    let key = key("https://example.test", "a");
    let actor = Persistence::open(root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    actor
        .save(key.clone(), "a".into(), token("a"))
        .await
        .unwrap();
    actor
        .checkpoint(
            key.clone(),
            vec![],
            Navigation {
                favorites: vec!["c1".into(), "c2".into()],
                ..Navigation::default()
            },
        )
        .await
        .unwrap();
    drop(actor);
    let navigation = root
        .store()
        .load_preferences::<Navigation>(&key)
        .unwrap()
        .unwrap();
    assert_eq!(navigation.favorites, vec!["c1", "c2"]);
}

#[tokio::test]
async fn actor_corruption_and_validation_never_overwrite() {
    let root = TempRoot::new();
    let actor = Persistence::open(root.0.clone(), FakeCredentials::default())
        .await
        .unwrap();
    let key = key("https://example.test", "a");
    let (accounts, _, _) = actor
        .save(key.clone(), "before".into(), token("before"))
        .await
        .unwrap();
    actor
        .checkpoint(key.clone(), vec![draft("before")], Navigation::default())
        .await
        .unwrap();
    let directory = root.0.join(&accounts[0].local_id);
    let drafts = fs::read(directory.join("drafts.json")).unwrap();
    assert!(
        actor
            .checkpoint(
                key.clone(),
                vec![draft("after")],
                Navigation {
                    channel_id: Some(" ".into()),
                    ..Navigation::default()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(fs::read(directory.join("drafts.json")).unwrap(), drafts);
    assert!(
        actor
            .checkpoint(
                key.clone(),
                vec![draft("after")],
                Navigation {
                    favorites: vec!["a".into(), "a".into()],
                    ..Navigation::default()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(fs::read(directory.join("drafts.json")).unwrap(), drafts);
    assert!(
        actor
            .checkpoint(
                key.clone(),
                vec![draft("after")],
                Navigation {
                    tabs: vec!["a".into(), "a".into()],
                    ..Navigation::default()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(fs::read(directory.join("drafts.json")).unwrap(), drafts);
    fs::write(
        directory.join("preferences.json"),
        br#"{"version":1,"data":{"channel_id":"c"}}"#,
    )
    .unwrap();
    let (_, _, legacy) = actor.restore(key.clone()).await.unwrap();
    assert_eq!(legacy.channel_id.as_deref(), Some("c"));
    assert!(legacy.tabs.is_empty());
    for bad in [
        br#"{"version":99,"data":{"channel_id":null}}"#.as_slice(),
        br#"{"version":1,"data":{"channel_id":" "}}"#,
        br#"{"version":1,"data":{"channel_id":null,"future":true}}"#,
        br#"{"version":1,"data":{"channel_id":null,"tabs":["a","a"]}}"#,
        br#"{"version":1,"data":{"channel_id":null,"tabs":[" "]}}"#,
        b"not json",
    ] {
        fs::write(directory.join("preferences.json"), bad).unwrap();
        assert!(actor.restore(key.clone()).await.is_err());
        assert!(
            actor
                .save(key.clone(), "after".into(), token("after"))
                .await
                .is_err()
        );
        assert!(
            actor
                .checkpoint(key.clone(), vec![draft("after")], Navigation::default())
                .await
                .is_err()
        );
        assert!(actor.sign_out(key.clone()).await.is_err());
        assert_eq!(fs::read(directory.join("preferences.json")).unwrap(), bad);
        assert_eq!(fs::read(directory.join("drafts.json")).unwrap(), drafts);
        assert_eq!(actor.accounts().await.unwrap()[0].username, "before");
    }
    fs::write(
        directory.join("preferences.json"),
        br#"{"version":1,"data":{"channel_id":null}}"#,
    )
    .unwrap();
    assert_eq!(
        actor.restore(key.clone()).await.unwrap().0.expose(),
        "before"
    );
    for bad in [
        br#"{"version":99,"data":null}"#.as_slice(),
        br#"{"version":1,"data":"../../unsafe"}"#,
        br#"{"version":1,"data":"00000000-0000-4000-8000-000000000000"}"#,
        b"not json",
    ] {
        fs::write(root.0.join("selection.json"), bad).unwrap();
        assert!(actor.selected().await.is_err());
        assert!(actor.select(None).await.is_err());
        assert!(actor.sign_out(key.clone()).await.is_err());
        assert!(
            Persistence::open(root.0.clone(), FakeCredentials::default())
                .await
                .is_err()
        );
        assert_eq!(fs::read(root.0.join("selection.json")).unwrap(), bad);
        assert!(actor.restore(key.clone()).await.is_ok());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn actor_ordering_abandoned_replies_and_failures() {
    use std::sync::{Arc, Mutex};
    struct Tracked {
        inner: FakeCredentials,
        events: Arc<Mutex<Vec<std::thread::ThreadId>>>,
    }
    impl CredentialStore for Tracked {
        fn get(&self, key: &AccountKey) -> Result<Option<Secret>> {
            self.inner.get(key)
        }
        fn save(&mut self, key: &AccountKey, token: &Secret) -> Result<()> {
            self.events
                .lock()
                .unwrap()
                .push(std::thread::current().id());
            self.inner.save(key, token)
        }
        fn remove(&mut self, key: &AccountKey) -> Result<()> {
            self.events
                .lock()
                .unwrap()
                .push(std::thread::current().id());
            self.inner.remove(key)
        }
    }
    let root = TempRoot::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let actor = Persistence::open(
        root.0.clone(),
        Tracked {
            inner: FakeCredentials {
                fail_remove: true,
                ..Default::default()
            },
            events: events.clone(),
        },
    )
    .await
    .unwrap();
    let key = key("https://example.test", "a");
    let (reply, abandoned) = oneshot::channel();
    actor
        .sender
        .send(Command::Save(
            key.clone(),
            "synthetic".into(),
            token("synthetic"),
            None,
            reply,
        ))
        .await
        .unwrap();
    drop(abandoned);
    assert_eq!(actor.accounts().await.unwrap().len(), 1);
    actor.select(Some(key.clone())).await.unwrap();
    assert!(actor.sign_out(key.clone()).await.is_err());
    assert_eq!(actor.selected().await.unwrap(), Some(key.clone()));
    assert!(actor.restore(key.clone()).await.is_ok());
    {
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], events[1]);
        assert_ne!(events[0], std::thread::current().id());
    }
    let failed_root = TempRoot::new();
    let failed = Persistence::open(
        failed_root.0.clone(),
        FakeCredentials {
            fail_save: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        failed
            .save(key, "synthetic".into(), token("synthetic"))
            .await
            .is_err()
    );
    assert!(failed.accounts().await.unwrap().is_empty());
    assert!(!failed_root.0.join("registry.json").exists());
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "explicit native invocation only; isolated synthetic Keychain CRUD"]
fn isolated_native_keychain_crud() {
    struct Cleanup {
        credentials: KeychainCredentials,
        key: AccountKey,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.credentials.remove(&self.key);
        }
    }
    let mut test = Cleanup {
        credentials: KeychainCredentials {
            service: format!("com.antimatter.synthetic.keychain-test.{}", Uuid::new_v4()),
        },
        key: key("https://synthetic.invalid", "synthetic-user"),
    };
    assert_ne!(test.credentials.service, KEYCHAIN_SERVICE);
    assert!(test.credentials.get(&test.key).unwrap().is_none());
    test.credentials
        .save(&test.key, &token("synthetic-first"))
        .unwrap();
    assert_eq!(
        test.credentials.get(&test.key).unwrap().unwrap().expose(),
        "synthetic-first"
    );
    test.credentials
        .save(&test.key, &token("synthetic-updated"))
        .unwrap();
    assert_eq!(
        test.credentials.get(&test.key).unwrap().unwrap().expose(),
        "synthetic-updated"
    );
    test.credentials.remove(&test.key).unwrap();
    assert!(test.credentials.get(&test.key).unwrap().is_none());
    test.credentials.remove(&test.key).unwrap();
}

#[test]
fn registry_keys_and_paths_are_validated() {
    for invalid in [
        r#"{"origin":"https://example.test","user_id":""}"#,
        r#"{"origin":"https://example.test/path","user_id":"a"}"#,
        r#"{"origin":"https://u:p@example.test","user_id":"a"}"#,
        r#"{"origin":"https://EXAMPLE.test:443/","user_id":"a"}"#,
    ] {
        assert!(serde_json::from_str::<AccountKey>(invalid).is_err());
    }
    let origin = ServerOrigin::new("https://example.test", false).unwrap();
    let mut user: User = serde_json::from_str(r#"{"id":"a","username":"a"}"#).unwrap();
    let valid = AccountKey::new(&origin, &user).unwrap();
    user.id.clear();
    assert!(AccountKey::new(&origin, &user).is_err());
    assert_eq!(
        serde_json::from_str::<AccountKey>(&serde_json::to_string(&valid).unwrap()).unwrap(),
        valid
    );
    let root = TempRoot::new();
    let ancestor_mode = fs::metadata(&root.0).unwrap().permissions().mode();
    let nested = root.0.join("new-parent/v1");
    AccountStore::open(&nested, FakeCredentials::default()).unwrap();
    assert_eq!(
        fs::metadata(&root.0).unwrap().permissions().mode(),
        ancestor_mode
    );
    for path in [root.0.join("new-parent"), nested] {
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    let mut registry = Registry {
        version: VERSION,
        accounts: vec![Account {
            local_id: "../../elsewhere".into(),
            key: valid,
            username: "a".into(),
            login_method: None,
            site_name: None,
        }],
    };
    fs::write(
        root.0.join("registry.json"),
        serde_json::to_vec(&registry).unwrap(),
    )
    .unwrap();
    assert!(AccountStore::open(&root.0, FakeCredentials::default()).is_err());
    registry.accounts[0].local_id = Uuid::new_v4().to_string();
    registry.accounts.push(registry.accounts[0].clone());
    assert!(registry.validate().is_err());
}

#[test]
fn login_method_is_optional_for_legacy_registry_entries_and_round_trips() {
    let root = TempRoot::new();
    let mut store = root.store();
    let key = key("https://example.test", "a");
    let saved = store
        .save_account_with_method(&key, "a", &token("synthetic"), Some(LoginMethod::Password))
        .unwrap();
    assert_eq!(saved.login_method, Some(LoginMethod::Password));
    let bytes = fs::read(store.root.join("registry.json")).unwrap();
    let registry: Registry = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        registry.accounts[0].login_method,
        Some(LoginMethod::Password)
    );
    let mut legacy = serde_json::to_value(registry).unwrap();
    legacy["accounts"][0]
        .as_object_mut()
        .unwrap()
        .remove("login_method");
    let registry: Registry = serde_json::from_value(legacy).unwrap();
    assert_eq!(registry.accounts[0].login_method, None);
}

#[test]
fn credential_failure_never_publishes_metadata() {
    let root = TempRoot::new();
    let mut store = root.store();
    let key = key("https://example.test", "a");
    store.credentials.fail_save = true;
    assert!(
        store
            .save_account(&key, "a", &token("synthetic-first"))
            .is_err()
    );
    assert!(store.accounts().is_empty());
    assert!(!root.0.join("registry.json").exists());
    store.credentials.fail_save = false;
    store
        .save_account(&key, "a", &token("synthetic-first"))
        .unwrap();
    let before = fs::read(root.0.join("registry.json")).unwrap();
    store.credentials.fail_save = true;
    assert!(
        store
            .save_account(&key, "renamed", &token("synthetic-second"))
            .is_err()
    );
    assert_eq!(fs::read(root.0.join("registry.json")).unwrap(), before);
    assert_eq!(store.accounts()[0].username, "a");
    assert_eq!(
        store.credential(&key).unwrap().unwrap().expose(),
        "synthetic-first"
    );
}

#[test]
fn users_ports_drafts_preferences_and_signout_are_isolated() {
    let root = TempRoot::new();
    let mut store = root.store();
    let keys = [
        key("https://example.test", "a"),
        key("https://example.test", "b"),
        key("https://example.test:8443", "a"),
    ];
    let mut ids = HashSet::new();
    let mut credential_ids = HashSet::new();
    for (i, key) in keys.iter().enumerate() {
        ids.insert(
            store
                .save_account(key, "name", &token(&format!("synthetic-{i}")))
                .unwrap()
                .local_id,
        );
        credential_ids.insert(key.credential_account().unwrap());
        store
            .save_drafts(key, &[draft(&format!("draft-{i}"))])
            .unwrap();
        store.save_preferences(key, &i).unwrap();
        assert_eq!(store.load_preferences::<usize>(key).unwrap(), Some(i));
    }
    assert_eq!(ids.len(), 3);
    assert_eq!(credential_ids.len(), 3);
    let metadata = fs::metadata(root.0.join("registry.json")).unwrap();
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert_eq!(
        fs::metadata(&root.0).unwrap().permissions().mode() & 0o777,
        0o700
    );
    store.credentials.fail_remove = true;
    assert!(store.sign_out(&keys[0]).is_err());
    assert_eq!(store.accounts().len(), 3);
    assert_eq!(store.load_drafts(&keys[0]).unwrap(), vec![draft("draft-0")]);
    assert!(store.credential(&keys[0]).unwrap().is_some());
    store.credentials.fail_remove = false;
    store.sign_out(&keys[0]).unwrap();
    assert_eq!(store.accounts().len(), 2);
    assert!(!store.credentials.values.contains_key(&keys[0]));
    for (i, key) in keys.iter().enumerate().skip(1) {
        assert_eq!(
            store.load_drafts(key).unwrap(),
            vec![draft(&format!("draft-{i}"))]
        );
        assert_eq!(
            store.credential(key).unwrap().unwrap().expose(),
            format!("synthetic-{i}")
        );
    }
    let reopened = AccountStore::open(&root.0, store.credentials).unwrap();
    assert_eq!(reopened.accounts().len(), 2);
}

#[test]
fn site_name_persists_and_defaults_for_old_registries() {
    let root = TempRoot::new();
    let mut store = AccountStore::open(&root.0, FakeCredentials::default()).unwrap();
    let key = key("https://example.test", "a");
    store.save_account(&key, "name", &token("synthetic")).unwrap();
    assert_eq!(store.accounts()[0].site_name, None);
    store.set_site_name(&key, "Example Chat").unwrap();
    let reopened = AccountStore::open(&root.0, store.credentials).unwrap();
    assert_eq!(
        reopened.accounts()[0].site_name.as_deref(),
        Some("Example Chat")
    );
}

#[test]
fn selected_import_is_copy_only_idempotent_and_preserves_orphans() {
    let root = TempRoot::new();
    let source_file = root.0.join("selected-legacy-source");
    fs::write(&source_file, b"synthetic untouched source").unwrap();
    let source_token = token("synthetic-source");
    let mut store = root.store();
    let first = key("https://example.test", "a");
    assert!(store.import_selected(&first, "a", &source_token).unwrap());
    assert!(
        !store
            .import_selected(&first, "changed", &token("synthetic-other"))
            .unwrap()
    );
    assert_eq!(store.credentials.saves, 1);
    assert_eq!(
        store.credential(&first).unwrap().unwrap().expose(),
        source_token.expose()
    );
    let orphan = key("https://example.test", "b");
    store
        .credentials
        .values
        .insert(orphan.clone(), "synthetic-recoverable".into());
    assert!(!store.import_selected(&orphan, "b", &source_token).unwrap());
    store.credentials.fail_get = true;
    assert!(
        store
            .import_selected(&key("https://example.test", "c"), "c", &source_token)
            .is_err()
    );
    assert_eq!(store.accounts().len(), 1);
    store.sign_out(&first).unwrap();
    assert_eq!(
        fs::read(&source_file).unwrap(),
        b"synthetic untouched source"
    );
    assert_eq!(source_token.expose(), "synthetic-source");
    assert_eq!(store.credentials.values[&orphan], "synthetic-recoverable");
}

#[test]
fn corrupt_unknown_and_changed_registry_are_never_overwritten() {
    for bytes in [b"not json".as_slice(), br#"{"version":99,"accounts":[]}"#] {
        let root = TempRoot::new();
        fs::write(root.0.join("registry.json"), bytes).unwrap();
        assert!(AccountStore::open(&root.0, FakeCredentials::default()).is_err());
        assert_eq!(fs::read(root.0.join("registry.json")).unwrap(), bytes);
    }
    let root = TempRoot::new();
    let mut store = root.store();
    fs::write(root.0.join("registry.json"), b"corrupt after open").unwrap();
    assert!(
        store
            .save_account(&key("https://example.test", "a"), "a", &token("synthetic"))
            .is_err()
    );
    assert_eq!(store.credentials.saves, 0);
    assert_eq!(
        fs::read(root.0.join("registry.json")).unwrap(),
        b"corrupt after open"
    );
}

#[test]
fn failed_disk_publish_keeps_old_registry_and_recoverable_credential() {
    let root = TempRoot::new();
    let mut store = root.store();
    let first = key("https://example.test", "a");
    store
        .save_account(&first, "a", &token("synthetic-old"))
        .unwrap();
    let before = fs::read(root.0.join("registry.json")).unwrap();
    fs::set_permissions(&root.0, fs::Permissions::from_mode(0o500)).unwrap();
    let result = store.save_account(&first, "changed", &token("synthetic-new"));
    fs::set_permissions(&root.0, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert_eq!(store.accounts()[0].username, "a");
    assert_eq!(fs::read(root.0.join("registry.json")).unwrap(), before);
    assert_eq!(store.credentials.values[&first], "synthetic-new");
    assert!(
        fs::read_dir(&root.0).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp"))
    );
}

#[test]
fn failed_serialization_and_invalid_records_preserve_previous_bytes() {
    #[derive(Deserialize)]
    struct Fails;
    impl Serialize for Fails {
        fn serialize<S: serde::Serializer>(&self, _: S) -> std::result::Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("synthetic serialization failure"))
        }
    }
    let root = TempRoot::new();
    let mut store = root.store();
    let key = key("https://example.test", "a");
    store.save_account(&key, "a", &token("synthetic")).unwrap();
    store.save_preferences(&key, &()).unwrap(); // unit decodes as Fails
    let directory = store.account_dir(&key).unwrap();
    let preferences = directory.join("preferences.json");
    let before = fs::read(&preferences).unwrap();
    assert!(store.save_preferences(&key, &Fails).is_err());
    assert_eq!(fs::read(&preferences).unwrap(), before);
    store.save_drafts(&key, &[draft("old")]).unwrap();
    let drafts = directory.join("drafts.json");
    for bytes in [
        b"corrupt".as_slice(),
        br#"{"version":99,"data":[]}"#,
        br#"{"version":1,"data":[{"pane_id":"","channel_id":"x","text":"x"}]}"#,
    ] {
        fs::write(&drafts, bytes).unwrap();
        assert!(store.save_drafts(&key, &[draft("new")]).is_err());
        assert_eq!(fs::read(&drafts).unwrap(), bytes);
    }
    fs::write(&preferences, br#"{"version":2,"data":null}"#).unwrap();
    assert!(store.save_preferences(&key, &()).is_err());
    assert_eq!(
        fs::read(&preferences).unwrap(),
        br#"{"version":2,"data":null}"#
    );
}

#[test]
fn symlinks_cannot_read_overwrite_or_delete_other_state() {
    use std::os::unix::fs::symlink;
    let root = TempRoot::new();
    let outside = TempRoot::new();
    fs::write(outside.0.join("source"), b"untouched").unwrap();
    let mut store = root.store();
    let key = key("https://example.test", "a");
    store.save_account(&key, "a", &token("synthetic")).unwrap();
    let directory = store.account_dir(&key).unwrap();
    symlink(&outside.0, &directory).unwrap();
    assert!(store.load_drafts(&key).is_err());
    assert!(store.save_drafts(&key, &[]).is_err());
    assert!(store.sign_out(&key).is_err());
    assert!(store.credential(&key).unwrap().is_some());
    assert_eq!(fs::read(outside.0.join("source")).unwrap(), b"untouched");
    assert!(AccountStore::open(root.0.join("../unsafe"), FakeCredentials::default()).is_err());
}
