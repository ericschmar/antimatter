use crate::state::*;
use antimatter_services::{
    accounts::{self, Account, Draft, Navigation},
    conversation::Intent,
};

impl State {
    pub(crate) fn autosave(&mut self) {
        if self.durable.is_some()
            && !self.busy
            && !self.submitted
            && !self.recovered_pending
            && self.pending.is_none()
            && self.checkpoint_retry.is_none()
            && (self.snapshot() != self.drafts || self.navigation != self.committed_navigation)
        {
            self.checkpoint(AfterCheckpoint::Save);
        }
    }

    pub(crate) fn close(&mut self) {
        self.autosave();
        if self.auth_writing
            && let (Some(task), Some(runtime)) = (self.auth_task.take(), self.runtime.clone())
        {
            let _ = runtime.block_on(task);
        }
        if let (Some(task), Some(runtime)) = (self.write_task.take(), self.runtime.clone()) {
            let _ = runtime.block_on(task);
        }
        self.epoch += 1;
        if let Some((AfterCheckpoint::Send(_), drafts, navigation)) = self.checkpoint_pending.take()
            && let (Some(store), Some(key), Some(runtime)) = (
                self.persistence.clone(),
                self.durable.clone(),
                self.runtime.clone(),
            )
        {
            if runtime
                .block_on(store.checkpoint(key, drafts.clone(), navigation.clone()))
                .is_ok()
            {
                self.drafts = drafts;
                self.committed_navigation = navigation;
            } else {
                self.error = Some("Draft rollback failed. Retry before leaving.");
                eprintln!("Draft rollback failed; unsent content is not confirmed saved.");
            }
        }
        // ponytail: Rune cannot veto close. Disk failure/crash before autosave commits
        // retains only the last durable edit; upgrade to a quit-confirmation API.
    }

    pub(crate) fn blocked(&mut self) -> bool {
        if self.busy
            || self.checkpoint_retry.is_some()
            || self.submitted
            || self.pending.is_some()
            || self.recovered_pending
        {
            self.error = Some(
                "Wait for pending delivery and durable writes before switching or signing out.",
            );
            true
        } else {
            false
        }
    }

    pub(crate) fn snapshot(&self) -> Vec<Draft> {
        let mut drafts = self.drafts.clone();
        if self.recovered_pending {
            return drafts;
        }
        if let Some(channel) = &self.channel {
            drafts.retain(|d| !(d.pane_id == COMPOSER && &d.channel_id == channel));
            let markdown = self.markdown();
            if !markdown.is_empty()
                && !drafts
                    .iter()
                    .any(|d| d.pane_id == SUBMITTED && &d.channel_id == channel)
            {
                drafts.push(Draft {
                    pane_id: COMPOSER.into(),
                    channel_id: channel.clone(),
                    text: markdown,
                });
            }
        }
        drafts
    }

    pub(crate) fn checkpoint(&mut self, action: AfterCheckpoint) {
        if !matches!(
            action,
            AfterCheckpoint::Acknowledge | AfterCheckpoint::Rollback
        ) && self.blocked()
        {
            return;
        }
        let Some(key) = self.durable.clone() else {
            self.finish_checkpoint(action, self.snapshot(), None);
            return;
        };
        let (Some(store), Some(runtime), Some(handle)) = (
            self.persistence.clone(),
            self.runtime.clone(),
            self.handle.clone(),
        ) else {
            self.checkpoint_retry = Some(action);
            self.error =
                Some("Draft storage unavailable. UNSAVED content retained; retry before closing.");
            return;
        };
        let original_drafts = self.snapshot();
        let mut drafts = original_drafts.clone();
        if matches!(action, AfterCheckpoint::Send(_)) {
            for draft in &mut drafts {
                if draft.pane_id == COMPOSER && Some(&draft.channel_id) == self.channel.as_ref() {
                    draft.pane_id = SUBMITTED.into();
                }
            }
        } else if matches!(action, AfterCheckpoint::Rollback) {
            for draft in &mut drafts {
                if draft.pane_id == SUBMITTED && Some(&draft.channel_id) == self.channel.as_ref() {
                    draft.pane_id = COMPOSER.into();
                }
            }
        } else if matches!(action, AfterCheckpoint::Acknowledge) {
            drafts.retain(|d| {
                !(matches!(d.pane_id.as_str(), COMPOSER | SUBMITTED)
                    && Some(&d.channel_id) == self.channel.as_ref())
            });
        }
        let navigation = Navigation {
            channel_id: self
                .channel
                .clone()
                .or_else(|| self.navigation.channel_id.clone()),
            tabs: self.navigation.tabs.clone(),
        };
        self.checkpoint_pending = Some((action.clone(), original_drafts, navigation.clone()));
        let epoch = self.epoch;
        self.busy = true;
        if matches!(action, AfterCheckpoint::Send(_)) {
            self.drafts = drafts.clone();
        }
        self.write_task = Some(runtime.spawn(async move {
            let result = async {
                store.checkpoint(key, drafts.clone(), navigation).await?;
                match &action {
                    AfterCheckpoint::SignOut(key) => store.sign_out(key.clone()).await.map(Some),
                    _ => Ok(None),
                }
            }
            .await;
            if result.is_err() {
                eprintln!("Durable update failed; latest content is not confirmed saved.");
            }
            handle.update(move |s, _| {
                if s.epoch != epoch {
                    return;
                }
                s.complete_checkpoint(action, drafts, result);
            });
        }));
    }

    pub(crate) fn complete_checkpoint(
        &mut self,
        action: AfterCheckpoint,
        drafts: Vec<Draft>,
        result: accounts::Result<Option<Vec<Account>>>,
    ) {
        self.busy = false;
        self.write_task = None;
        match result {
            Ok(accounts) => self.finish_checkpoint(action, drafts, accounts),
            Err(_) => {
                self.checkpoint_pending = None;
                if matches!(action, AfterCheckpoint::Send(_)) {
                    self.checkpoint(AfterCheckpoint::Rollback);
                    return;
                }
                self.checkpoint_retry = Some(action);
                self.error = Some("Durable update failed. Content retained; retry before leaving.");
            }
        }
    }

    pub(crate) fn finish_checkpoint(
        &mut self,
        action: AfterCheckpoint,
        drafts: Vec<Draft>,
        accounts: Option<Vec<Account>>,
    ) {
        self.drafts = drafts;
        if let Some((_, _, navigation)) = self.checkpoint_pending.take() {
            self.committed_navigation = navigation;
        }
        self.checkpoint_retry = None;
        self.error = None;
        match action {
            AfterCheckpoint::Save => (),
            AfterCheckpoint::Rollback => {
                self.recovered_pending = false;
                self.error = Some("Send was not queued. Draft saved; try Send again.");
            }
            AfterCheckpoint::Disconnect => self.clear_session(),
            AfterCheckpoint::SignOut(key) => {
                self.clear_session();
                if self.selected.as_ref() == Some(&key) {
                    self.selected = None;
                }
                if let Some(accounts) = accounts {
                    self.accounts = accounts;
                }
            }
            AfterCheckpoint::Send(message) => {
                if self.dispatch(Intent::Send(message)) {
                    self.submitted = true;
                    self.ready = false;
                } else if self.durable.is_some() {
                    self.checkpoint(AfterCheckpoint::Rollback);
                }
            }
            AfterCheckpoint::Load(channel) => self.load_now(channel),
            AfterCheckpoint::Acknowledge => {
                self.clear_draft();
                self.submitted = false;
                self.recovered_pending = false;
                self.checkpoint_retry = None;
            }
        }
    }
}
