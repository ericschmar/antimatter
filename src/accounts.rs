use crate::mattermost::{Secret, ServerOrigin, User};
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use std::{
    collections::HashSet,
    fmt, fs,
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

const VERSION: u32 = 1;
pub const KEYCHAIN_SERVICE: &str = "com.antimatter.desktop.mattermost.rust.v1";

pub enum Error {
    Io(io::Error),
    Json(serde_json::Error),
    Invalid(&'static str),
    Credential(i32),
    DurabilityUncertain(io::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "account storage I/O failure ({:?})", e.kind()),
            Self::Json(_) => f.write_str("invalid account JSON"),
            Self::Invalid(reason) => f.write_str(reason),
            Self::Credential(code) => write!(f, "credential operation failed ({code})"),
            Self::DurabilityUncertain(_) => {
                f.write_str("account write committed; durability uncertain")
            }
        }
    }
}
impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}
impl std::error::Error for Error {}
impl From<io::Error> for Error {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
pub struct AccountKey {
    origin: String,
    user_id: String,
}

impl AccountKey {
    pub fn new(origin: &ServerOrigin, user: &User) -> Result<Self> {
        Self::validated(origin.as_str().to_owned(), user.id.clone())
    }

    fn validated(origin: String, user_id: String) -> Result<Self> {
        if user_id.trim().is_empty() {
            return Err(Error::Invalid("empty account user ID"));
        }
        let canonical = ServerOrigin::new(&origin, true)
            .map_err(|_| Error::Invalid("invalid account origin"))?;
        if canonical.as_str() != origin {
            return Err(Error::Invalid("account origin is not canonical"));
        }
        Ok(Self { origin, user_id })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }
    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn credential_account(&self) -> Result<String> {
        Ok(serde_json::to_string(&(&self.origin, &self.user_id))?)
    }
}

impl<'de> Deserialize<'de> for AccountKey {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Raw {
            origin: String,
            user_id: String,
        }
        let raw = Raw::deserialize(d)?;
        Self::validated(raw.origin, raw.user_id).map_err(serde::de::Error::custom)
    }
}

pub trait CredentialStore {
    fn get(&self, key: &AccountKey) -> Result<Option<Secret>>;
    fn save(&mut self, key: &AccountKey, token: &Secret) -> Result<()>;
    fn remove(&mut self, key: &AccountKey) -> Result<()>;
}

#[cfg(target_os = "macos")]
pub struct KeychainCredentials;

#[cfg(target_os = "macos")]
impl KeychainCredentials {
    fn options(key: &AccountKey) -> Result<security_framework::passwords::PasswordOptions> {
        let mut options = security_framework::passwords::PasswordOptions::new_generic_password(
            KEYCHAIN_SERVICE,
            &key.credential_account()?,
        );
        options.set_access_synchronized(Some(false));
        Ok(options)
    }
}

#[cfg(target_os = "macos")]
impl CredentialStore for KeychainCredentials {
    fn get(&self, key: &AccountKey) -> Result<Option<Secret>> {
        use zeroize::Zeroizing;
        match security_framework::passwords::generic_password(Self::options(key)?) {
            Ok(bytes) => {
                let bytes = Zeroizing::new(bytes);
                let text = std::str::from_utf8(&bytes)
                    .map_err(|_| Error::Invalid("invalid credential encoding"))?;
                Secret::new(text.to_owned())
                    .map(Some)
                    .map_err(|_| Error::Invalid("invalid stored credential"))
            }
            Err(e) if e.code() == -25300 => Ok(None),
            Err(e) => Err(Error::Credential(e.code())),
        }
    }

    fn save(&mut self, key: &AccountKey, token: &Secret) -> Result<()> {
        use security_framework::access_control::{ProtectionMode, SecAccessControl};
        let mut options = Self::options(key)?;
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleAfterFirstUnlock),
            0,
        )
        .map_err(|e| Error::Credential(e.code()))?;
        options.set_access_control(access);
        security_framework::passwords::set_generic_password_options(
            token.expose().as_bytes(),
            options,
        )
        .map_err(|e| Error::Credential(e.code()))
    }

    fn remove(&mut self, key: &AccountKey) -> Result<()> {
        match security_framework::passwords::delete_generic_password_options(Self::options(key)?) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(Error::Credential(e.code())),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub local_id: String,
    pub key: AccountKey,
    pub username: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    version: u32,
    accounts: Vec<Account>,
}

impl Registry {
    fn validate(&self) -> Result<()> {
        check_version(self.version)?;
        let mut ids = HashSet::new();
        let mut keys = HashSet::new();
        for account in &self.accounts {
            let id = Uuid::parse_str(&account.local_id)
                .map_err(|_| Error::Invalid("invalid local account ID"))?;
            if id.get_version_num() != 4
                || id.to_string() != account.local_id
                || !ids.insert(&account.local_id)
                || !keys.insert(&account.key)
            {
                return Err(Error::Invalid("invalid or duplicate registry identity"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub pane_id: String,
    pub channel_id: String,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record<T> {
    version: u32,
    data: T,
}

fn check_version(version: u32) -> Result<()> {
    if version != VERSION {
        return Err(Error::Invalid("unsupported account schema version"));
    }
    Ok(())
}

fn validate_drafts(drafts: &[Draft]) -> Result<()> {
    let mut keys = HashSet::new();
    for draft in drafts {
        if draft.pane_id.trim().is_empty()
            || draft.channel_id.trim().is_empty()
            || !keys.insert((&draft.pane_id, &draft.channel_id))
        {
            return Err(Error::Invalid("invalid or duplicate draft identity"));
        }
    }
    Ok(())
}

pub struct AccountStore<C: CredentialStore> {
    root: PathBuf,
    registry: Registry,
    credentials: C,
}

impl<C: CredentialStore> AccountStore<C> {
    pub fn default_root() -> Result<PathBuf> {
        let home = std::env::var_os("HOME").ok_or(Error::Invalid("missing home directory"))?;
        Ok(PathBuf::from(home).join("Library/Application Support/Antimatter/Rust/v1"))
    }

    pub fn open(root: impl AsRef<Path>, credentials: C) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        ensure_dir(&root)?;
        let registry = read_json::<Registry>(&root.join("registry.json"))?.unwrap_or(Registry {
            version: VERSION,
            accounts: Vec::new(),
        });
        registry.validate()?;
        Ok(Self {
            root,
            registry,
            credentials,
        })
    }

    pub fn accounts(&self) -> &[Account] {
        &self.registry.accounts
    }

    pub fn credential(&self, key: &AccountKey) -> Result<Option<Secret>> {
        self.account(key)?;
        self.credentials.get(key)
    }

    pub fn save_account(
        &mut self,
        key: &AccountKey,
        username: &str,
        token: &Secret,
    ) -> Result<Account> {
        self.check_registry()?;
        let mut next = self.registry.clone();
        let account = if let Some(account) = next.accounts.iter_mut().find(|a| &a.key == key) {
            account.username = username.to_owned();
            account.clone()
        } else {
            let account = Account {
                local_id: Uuid::new_v4().to_string(),
                key: key.clone(),
                username: username.to_owned(),
            };
            next.accounts.push(account.clone());
            account
        };
        self.credentials.save(key, token)?;
        self.publish(next)?;
        Ok(account)
    }

    pub fn import_selected(
        &mut self,
        key: &AccountKey,
        username: &str,
        token: &Secret,
    ) -> Result<bool> {
        self.check_registry()?;
        if self.registry.accounts.iter().any(|a| &a.key == key)
            || self.credentials.get(key)?.is_some()
        {
            return Ok(false);
        }
        self.save_account(key, username, token)?;
        Ok(true)
    }

    pub fn load_drafts(&self, key: &AccountKey) -> Result<Vec<Draft>> {
        let drafts: Vec<Draft> = self.load_record(key, "drafts.json")?.unwrap_or_default();
        validate_drafts(&drafts)?;
        Ok(drafts)
    }

    pub fn save_drafts(&mut self, key: &AccountKey, drafts: &[Draft]) -> Result<()> {
        validate_drafts(drafts)?;
        self.load_drafts(key)?;
        self.save_record(key, "drafts.json", &drafts)
    }

    pub fn load_preferences<T: DeserializeOwned>(&self, key: &AccountKey) -> Result<Option<T>> {
        self.load_record(key, "preferences.json")
    }

    pub fn save_preferences<T: Serialize + DeserializeOwned>(
        &mut self,
        key: &AccountKey,
        data: &T,
    ) -> Result<()> {
        self.load_preferences::<T>(key)?;
        self.save_record(key, "preferences.json", data)
    }

    pub fn sign_out(&mut self, key: &AccountKey) -> Result<()> {
        self.check_registry()?;
        let directory = self.account_dir(key)?;
        if directory.exists() {
            check_path(&directory, true)?;
            for entry in fs::read_dir(&directory)? {
                let entry = entry?;
                if entry.file_name() != "drafts.json" && entry.file_name() != "preferences.json" {
                    return Err(Error::Invalid("unexpected account state file"));
                }
                check_path(&entry.path(), false)?;
            }
        }
        self.credentials.remove(key)?;
        for name in ["drafts.json", "preferences.json"] {
            let file = directory.join(name);
            check_path(&file, false)?;
            match fs::remove_file(file) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        match fs::remove_dir(&directory) {
            Ok(()) => fs::File::open(&self.root)?.sync_all()?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
        let mut next = self.registry.clone();
        next.accounts.retain(|a| &a.key != key);
        self.publish(next)
    }

    fn account(&self, key: &AccountKey) -> Result<&Account> {
        self.registry
            .accounts
            .iter()
            .find(|a| &a.key == key)
            .ok_or(Error::Invalid("unknown account"))
    }

    fn account_dir(&self, key: &AccountKey) -> Result<PathBuf> {
        Ok(self.root.join(&self.account(key)?.local_id))
    }

    fn check_registry(&self) -> Result<()> {
        check_path(&self.root, true)?;
        let disk = read_json::<Registry>(&self.root.join("registry.json"))?.unwrap_or(Registry {
            version: VERSION,
            accounts: Vec::new(),
        });
        disk.validate()?;
        if disk != self.registry {
            return Err(Error::Invalid("account registry changed; reopen store"));
        }
        Ok(())
    }

    fn publish(&mut self, next: Registry) -> Result<()> {
        next.validate()?;
        let result = atomic_json(&self.root.join("registry.json"), &next);
        if result.is_ok() || matches!(&result, Err(Error::DurabilityUncertain(_))) {
            self.registry = next;
        }
        result
    }

    fn load_record<T: DeserializeOwned>(&self, key: &AccountKey, name: &str) -> Result<Option<T>> {
        self.check_registry()?;
        let record = read_json::<Record<T>>(&self.account_dir(key)?.join(name))?;
        record
            .map(|record| {
                check_version(record.version)?;
                Ok(record.data)
            })
            .transpose()
    }

    fn save_record<T: Serialize>(&mut self, key: &AccountKey, name: &str, data: &T) -> Result<()> {
        self.check_registry()?;
        let bytes = serde_json::to_vec(&Record {
            version: VERSION,
            data,
        })?;
        let directory = self.account_dir(key)?;
        ensure_dir(&directory)?;
        atomic_bytes(&directory.join(name), &bytes)
    }
}

/// ponytail: path checks reject symlinks, but are not race-proof against a malicious
/// same-user process replacing ancestors. Upgrade to descriptor-relative openat if
/// that threat is in scope; single-owner serialization is not a process lock.
fn check_path(path: &Path, directory: bool) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::Invalid("storage root must be absolute"));
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => current.push(component.as_os_str()),
            _ => return Err(Error::Invalid("unsafe storage path")),
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                let is_last = current == path;
                if meta.file_type().is_symlink()
                    || ((!is_last || directory) && !meta.is_dir())
                    || (is_last && !directory && !meta.is_file())
                {
                    return Err(Error::Invalid("unsafe storage path type"));
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn ensure_dir(path: &Path) -> Result<()> {
    check_path(path, true)?;
    if !path.exists() {
        let parent = path
            .parent()
            .ok_or(Error::Invalid("missing storage parent"))?;
        if !parent.exists() {
            ensure_dir(parent)?;
        }
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(path) {
            Ok(()) => fs::File::open(parent)?.sync_all()?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => check_path(path, true)?,
            Err(e) => return Err(e.into()),
        }
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    check_path(path, false)?;
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    atomic_bytes(path, &serde_json::to_vec(value)?)
}

fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    check_path(path, false)?;
    let parent = path
        .parent()
        .ok_or(Error::Invalid("missing storage parent"))?;
    check_path(parent, true)?;
    let directory = fs::File::open(parent)?;
    let temp = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        directory.sync_all()?;
        check_path(path, false)?;
        fs::rename(&temp, path)?;
        directory.sync_all().map_err(Error::DurabilityUncertain)
    })();
    if temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
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
            fn serialize<S: serde::Serializer>(
                &self,
                _: S,
            ) -> std::result::Result<S::Ok, S::Error> {
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
}
