#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PostSearchFilters {
    pub channel: String,
    pub sender: String,
    pub after: String,
    pub before: String,
    pub has_files: bool,
    pub file_extension: String,
    pub thread_scope: ThreadScope,
    pub pinned_only: bool,
    pub saved_only: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThreadScope {
    #[default]
    All,
    Roots,
    Replies,
}

pub(super) fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            _ => b.is_ascii_digit(),
        })
}

impl PostSearchFilters {
    pub fn is_active(&self) -> bool {
        !self.channel.is_empty()
            || !self.sender.is_empty()
            || is_date(&self.after)
            || is_date(&self.before)
            || self.has_files
            || !self.file_extension.is_empty()
            || self.thread_scope != ThreadScope::All
            || self.pinned_only
            || self.saved_only
    }

    pub fn applying(&self, query: &str) -> String {
        let mut terms = vec![query.trim().to_owned()];
        let mut push = |modifier: String| terms.push(modifier);
        if !self.channel.is_empty() {
            push(format!("in:{}", self.channel));
        }
        if !self.sender.is_empty() {
            push(format!("from:{}", self.sender));
        }
        if is_date(&self.after) {
            push(format!("after:{}", self.after));
        }
        if is_date(&self.before) {
            push(format!("before:{}", self.before));
        }
        if self.has_files {
            push("has:files".to_owned());
        }
        let extension = self.file_extension.trim().trim_matches('.');
        if !extension.is_empty() {
            push(format!("ext:{extension}"));
        }
        match self.thread_scope {
            ThreadScope::All => {}
            ThreadScope::Roots => push("-is:reply".to_owned()),
            ThreadScope::Replies => push("is:reply".to_owned()),
        }
        if self.pinned_only {
            push("is:pinned".to_owned());
        }
        if self.saved_only {
            push("is:saved".to_owned());
        }
        terms.retain(|t| !t.is_empty());
        terms.join(" ")
    }
}
