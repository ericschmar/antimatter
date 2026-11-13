use crate::mattermost::{Secret, ServerOrigin, User};
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use std::{
    collections::HashSet,
    fmt, fs,
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};
use tokio::sync::{mpsc, oneshot};
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

pub type Result<T> = std::result::Result<T, Error>;

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
pub struct KeychainCredentials {
    service: String,
}

#[cfg(target_os = "macos")]
impl Default for KeychainCredentials {
    fn default() -> Self {
        Self {
            service: KEYCHAIN_SERVICE.to_owned(),
        }
    }
}

#[cfg(target_os = "macos")]
impl KeychainCredentials {
    fn options(&self, key: &AccountKey) -> Result<security_framework::passwords::PasswordOptions> {
        let mut options = security_framework::passwords::PasswordOptions::new_generic_password(
            &self.service,
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
        match security_framework::passwords::generic_password(self.options(key)?) {
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
        const MISSING_ENTITLEMENT: i32 = -34018;
        let mut options = self.options(key)?;
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleAfterFirstUnlock),
            0,
        )
        .map_err(|e| Error::Credential(e.code()))?;
        options.set_access_control(access);
        match security_framework::passwords::set_generic_password_options(
            token.expose().as_bytes(),
            options,
        ) {
            Ok(()) => Ok(()),
            // Unsigned builds lack the entitlement for the protected keychain;
            // use the login keychain instead.
            Err(e) if e.code() == MISSING_ENTITLEMENT => {
                security_framework::passwords::set_generic_password_options(
                    token.expose().as_bytes(),
                    self.options(key)?,
                )
                .map_err(|e| Error::Credential(e.code()))
            }
            Err(e) => Err(Error::Credential(e.code())),
        }
    }

    fn remove(&mut self, key: &AccountKey) -> Result<()> {
        match security_framework::passwords::delete_generic_password_options(self.options(key)?) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(Error::Credential(e.code())),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginMethod {
    Pat,
    Password,
    Sso,
}

impl LoginMethod {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pat => "PAT",
            Self::Password => "Password",
            Self::Sso => "SSO",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub local_id: String,
    pub key: AccountKey,
    pub username: String,
    #[serde(default)]
    pub login_method: Option<LoginMethod>,
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

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Navigation {
    pub channel_id: Option<String>,
    #[serde(default)]
    pub tabs: Vec<String>,
    #[serde(default)]
    pub favorites: Vec<String>,
}

pub const MAX_TABS: usize = 32;
pub const MAX_FAVORITES: usize = 64;

impl Navigation {
    fn validate(&self) -> Result<()> {
        if self
            .channel_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty())
        {
            return Err(Error::Invalid("empty navigation channel ID"));
        }
        if self.tabs.len() > MAX_TABS
            || self.tabs.iter().any(|id| id.trim().is_empty())
            || self
                .tabs
                .iter()
                .enumerate()
                .any(|(i, id)| self.tabs[..i].contains(id))
        {
            return Err(Error::Invalid("invalid navigation tabs"));
        }
        if self.favorites.len() > MAX_FAVORITES
            || self.favorites.iter().any(|id| id.trim().is_empty())
            || self
                .favorites
                .iter()
                .enumerate()
                .any(|(i, id)| self.favorites[..i].contains(id))
        {
            return Err(Error::Invalid("invalid navigation favorites"));
        }
        Ok(())
    }
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
        self.save_account_with_method(key, username, token, None)
    }

    pub fn save_account_with_method(
        &mut self,
        key: &AccountKey,
        username: &str,
        token: &Secret,
        login_method: Option<LoginMethod>,
    ) -> Result<Account> {
        self.check_registry()?;
        let mut next = self.registry.clone();
        let account = if let Some(account) = next.accounts.iter_mut().find(|a| &a.key == key) {
            account.username = username.to_owned();
            if login_method.is_some() {
                account.login_method = login_method;
            }
            account.clone()
        } else {
            let account = Account {
                local_id: Uuid::new_v4().to_string(),
                key: key.clone(),
                username: username.to_owned(),
                login_method,
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

    fn selected(&self) -> Result<Option<AccountKey>> {
        self.check_registry()?;
        let record = read_json::<Record<Option<String>>>(&self.root.join("selection.json"))?;
        let Some(record) = record else {
            return Ok(None);
        };
        check_version(record.version)?;
        record
            .data
            .map(|id| {
                self.registry
                    .accounts
                    .iter()
                    .find(|account| account.local_id == id)
                    .map(|account| account.key.clone())
                    .ok_or(Error::Invalid("unknown selected account ID"))
            })
            .transpose()
    }

    fn select(&mut self, key: Option<&AccountKey>) -> Result<()> {
        self.selected()?; // Never replace corrupt or unknown selection records.
        let id = key
            .map(|key| self.account(key).map(|account| account.local_id.clone()))
            .transpose()?;
        atomic_json(
            &self.root.join("selection.json"),
            &Record {
                version: VERSION,
                data: id,
            },
        )
    }

    pub fn sign_out(&mut self, key: &AccountKey) -> Result<()> {
        self.check_registry()?;
        let clear_selection = self.selected()?.as_ref() == Some(key);
        self.load_drafts(key)?;
        self.load_preferences::<serde_json::Value>(key)?;
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
        if clear_selection {
            self.select(None)?;
        }
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

type Snapshot = (Vec<Account>, Vec<Draft>, Navigation);

enum Command {
    Accounts(oneshot::Sender<Result<Vec<Account>>>),
    Selected(oneshot::Sender<Result<Option<AccountKey>>>),
    Select(Option<AccountKey>, oneshot::Sender<Result<()>>),
    Restore(
        AccountKey,
        oneshot::Sender<Result<(Secret, Vec<Draft>, Navigation)>>,
    ),
    Save(
        AccountKey,
        String,
        Secret,
        Option<LoginMethod>,
        oneshot::Sender<Result<Snapshot>>,
    ),
    Checkpoint(
        AccountKey,
        Vec<Draft>,
        Navigation,
        oneshot::Sender<Result<()>>,
    ),
    SignOut(AccountKey, oneshot::Sender<Result<Vec<Account>>>),
}

/// A cloneable handle to one native thread owning all filesystem and credential I/O.
/// Accepted commands finish even if the caller drops its reply future.
#[derive(Clone)]
pub struct Persistence {
    sender: mpsc::Sender<Command>,
}

impl Persistence {
    pub async fn open(
        root: PathBuf,
        credentials: impl CredentialStore + Send + 'static,
    ) -> Result<Self> {
        let (sender, mut receiver) = mpsc::channel(32);
        let (ready, opened) = oneshot::channel();
        std::thread::Builder::new()
            .name("account-persistence".into())
            .spawn(move || {
                let mut store = match AccountStore::open(root, credentials).and_then(|store| {
                    store.selected()?;
                    Ok(store)
                }) {
                    Ok(store) => store,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                if ready.send(Ok(())).is_err() {
                    return;
                }
                while let Some(command) = receiver.blocking_recv() {
                    match command {
                        Command::Accounts(reply) => {
                            let _ = reply
                                .send(store.check_registry().map(|()| store.accounts().to_vec()));
                        }
                        Command::Selected(reply) => {
                            let _ = reply.send(store.selected());
                        }
                        Command::Select(key, reply) => {
                            let _ = reply.send(store.select(key.as_ref()));
                        }
                        Command::Restore(key, reply) => {
                            let result = (|| {
                                let (drafts, navigation) = load_state(&store, &key)?;
                                let secret = store.credential(&key)?.ok_or(Error::Invalid(
                                    "saved credential is missing; sign in again",
                                ))?;
                                Ok((secret, drafts, navigation))
                            })();
                            let _ = reply.send(result);
                        }
                        Command::Save(key, username, token, login_method, reply) => {
                            let result = (|| {
                                store.check_registry()?;
                                let (drafts, navigation) =
                                    if store.accounts().iter().any(|account| account.key == key) {
                                        load_state(&store, &key)?
                                    } else {
                                        (Vec::new(), Navigation::default())
                                    };
                                store.save_account_with_method(
                                    &key,
                                    &username,
                                    &token,
                                    login_method,
                                )?;
                                Ok((store.accounts().to_vec(), drafts, navigation))
                            })();
                            let _ = reply.send(result);
                        }
                        Command::Checkpoint(key, drafts, navigation, reply) => {
                            let result = (|| {
                                validate_drafts(&drafts)?;
                                navigation.validate()?;
                                load_state(&store, &key)?;
                                // ponytail: records are atomic separately, not a multi-file transaction.
                                // Preflight prevents corrupt-state overwrites; an I/O failure can leave
                                // drafts committed without navigation. Upgrade to a combined record if needed.
                                store.save_drafts(&key, &drafts)?;
                                store.save_preferences(&key, &navigation)
                            })();
                            let _ = reply.send(result);
                        }
                        Command::SignOut(key, reply) => {
                            let result = (|| {
                                load_state(&store, &key)?;
                                store.sign_out(&key)?;
                                Ok(store.accounts().to_vec())
                            })();
                            let _ = reply.send(result);
                        }
                    }
                }
            })?;
        opened
            .await
            .map_err(|_| Error::Invalid("account persistence worker stopped"))??;
        Ok(Self { sender })
    }

    async fn request<T>(
        &self,
        command: impl FnOnce(oneshot::Sender<Result<T>>) -> Command,
    ) -> Result<T> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(command(reply))
            .await
            .map_err(|_| Error::Invalid("account persistence worker stopped"))?;
        response
            .await
            .map_err(|_| Error::Invalid("account persistence worker stopped"))?
    }

    pub async fn accounts(&self) -> Result<Vec<Account>> {
        self.request(Command::Accounts).await
    }

    pub async fn selected(&self) -> Result<Option<AccountKey>> {
        self.request(Command::Selected).await
    }

    pub async fn select(&self, key: Option<AccountKey>) -> Result<()> {
        self.request(|reply| Command::Select(key, reply)).await
    }

    pub async fn restore(&self, key: AccountKey) -> Result<(Secret, Vec<Draft>, Navigation)> {
        self.request(|reply| Command::Restore(key, reply)).await
    }

    pub async fn save(&self, key: AccountKey, username: String, token: Secret) -> Result<Snapshot> {
        self.save_with_method(key, username, token, None).await
    }

    pub async fn save_with_method(
        &self,
        key: AccountKey,
        username: String,
        token: Secret,
        login_method: Option<LoginMethod>,
    ) -> Result<Snapshot> {
        self.request(|reply| Command::Save(key, username, token, login_method, reply))
            .await
    }

    pub async fn checkpoint(
        &self,
        key: AccountKey,
        drafts: Vec<Draft>,
        navigation: Navigation,
    ) -> Result<()> {
        self.request(|reply| Command::Checkpoint(key, drafts, navigation, reply))
            .await
    }

    pub async fn sign_out(&self, key: AccountKey) -> Result<Vec<Account>> {
        self.request(|reply| Command::SignOut(key, reply)).await
    }
}

fn load_state<C: CredentialStore>(
    store: &AccountStore<C>,
    key: &AccountKey,
) -> Result<(Vec<Draft>, Navigation)> {
    let drafts = store.load_drafts(key)?;
    let navigation = store
        .load_preferences::<Navigation>(key)?
        .unwrap_or_default();
    navigation.validate()?;
    Ok((drafts, navigation))
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
mod tests;
