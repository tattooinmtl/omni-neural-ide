//! Path guardrails enforced before any write.
//!
//! System directories are scan-only. Agent writes stay on the allow-list.
//! The assistant may write only files the editor has open. Deletes and
//! rollbacks ask for confirmation when that setting is on.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Read,
    Write,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    ScanOnly,
    OutsideAllowList,
    NeedsConfirmation,
    NotOpen,
}

impl Verdict {
    pub fn allowed(self) -> bool {
        self == Self::Allow
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Allow => "allowed",
            Self::ScanOnly => "system path is scan-only",
            Self::OutsideAllowList => "path is outside the allow-list",
            Self::NeedsConfirmation => "destructive action needs confirmation",
            Self::NotOpen => "assistant can edit open files only",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Policy {
    pub install_root: PathBuf,
    pub workspace: PathBuf,
    pub open_files: Vec<PathBuf>,
    pub confirm_destructive: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct Request<'a> {
    pub action: Action,
    pub path: &'a Path,
    pub confirmed: bool,
    pub assistant: bool,
}

pub fn judge(policy: &Policy, request: Request<'_>) -> Verdict {
    let path = normalize(request.path);
    if is_scan_only(policy, &path) {
        return match request.action {
            Action::Read => Verdict::Allow,
            Action::Write | Action::Delete => Verdict::ScanOnly,
        };
    }

    let allowed_root = write_roots(policy).iter().any(|root| is_within(&path, root));
    let readable = allowed_root || is_within(&path, &policy.install_root);

    match request.action {
        Action::Read => {
            if readable {
                Verdict::Allow
            } else {
                Verdict::OutsideAllowList
            }
        }
        Action::Write | Action::Delete => {
            if !allowed_root {
                return Verdict::OutsideAllowList;
            }
            if request.assistant && request.action == Action::Write && !is_open(policy, &path) {
                return Verdict::NotOpen;
            }
            if request.action == Action::Delete && policy.confirm_destructive && !request.confirmed {
                return Verdict::NeedsConfirmation;
            }
            Verdict::Allow
        }
    }
}

pub fn write_roots(policy: &Policy) -> Vec<PathBuf> {
    vec![
        policy.workspace.clone(),
        policy.install_root.join("skills"),
        policy.install_root.join("tools"),
        policy.install_root.join("plugins"),
    ]
}

fn is_scan_only(policy: &Policy, path: &Path) -> bool {
    let mut roots = system_roots();
    roots.push(policy.install_root.join("core"));
    roots.push(policy.install_root.join("launcher"));
    roots.push(policy.install_root.join("ui"));
    roots.push(policy.install_root.join("docs"));
    roots.push(policy.install_root.join("DESIGN.md"));
    roots.push(policy.install_root.join("README.md"));
    roots.iter().any(|root| is_within(path, root))
}

fn is_open(policy: &Policy, path: &Path) -> bool {
    policy
        .open_files
        .iter()
        .any(|open| same_file(path, &normalize(open)))
}

fn same_file(left: &Path, right: &Path) -> bool {
    norm_key(left) == norm_key(right)
}

fn system_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from(r"C:\Windows"),
        PathBuf::from(r"C:\Program Files"),
        PathBuf::from(r"C:\Program Files (x86)"),
    ];
    if let Ok(root) = std::env::var("SystemRoot") {
        roots.push(PathBuf::from(root));
    }
    roots
}

pub fn normalize(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return strip_verbatim(canonical);
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(canonical) = parent.canonicalize() {
            return strip_verbatim(canonical).join(name);
        }
        if let Ok(absolute) = std::path::absolute(parent) {
            return absolute.join(name);
        }
    }
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().into_owned();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

fn is_within(path: &Path, root: &Path) -> bool {
    let path = norm_key(path);
    let root = norm_key(root);
    path == root || path.starts_with(&(root.trim_end_matches('\\').to_string() + "\\"))
}

fn norm_key(path: &Path) -> String {
    strip_verbatim(path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .trim_start_matches(r"\\?\")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn policy(root: &Path) -> Policy {
        Policy {
            install_root: root.to_path_buf(),
            workspace: root.join("workspace"),
            open_files: vec![root.join("workspace").join("plan.md")],
            confirm_destructive: true,
        }
    }

    #[test]
    fn system_paths_are_scan_only() {
        let root = std::env::temp_dir().join(format!("omni-guard-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("workspace")).unwrap();
        let policy = policy(&root);
        let hosts = PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts");
        assert_eq!(
            judge(&policy, Request { action: Action::Read, path: &hosts, confirmed: false, assistant: false }),
            Verdict::Allow
        );
        assert_eq!(
            judge(&policy, Request { action: Action::Write, path: &hosts, confirmed: true, assistant: false }),
            Verdict::ScanOnly
        );
        let harness = root.join("core").join("src").join("main.rs");
        assert_eq!(
            judge(&policy, Request { action: Action::Write, path: &harness, confirmed: true, assistant: true }),
            Verdict::ScanOnly
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn assistant_writes_only_open_workspace_files() {
        let root = std::env::temp_dir().join(format!("omni-guard-open-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("workspace")).unwrap();
        let policy = policy(&root);
        let open = root.join("workspace").join("plan.md");
        let closed = root.join("workspace").join("secret.md");
        assert_eq!(
            judge(&policy, Request { action: Action::Write, path: &open, confirmed: false, assistant: true }),
            Verdict::Allow
        );
        assert_eq!(
            judge(&policy, Request { action: Action::Write, path: &closed, confirmed: false, assistant: true }),
            Verdict::NotOpen
        );
        assert_eq!(
            judge(&policy, Request { action: Action::Delete, path: &open, confirmed: false, assistant: false }),
            Verdict::NeedsConfirmation
        );
        assert_eq!(
            judge(&policy, Request { action: Action::Delete, path: &open, confirmed: true, assistant: false }),
            Verdict::Allow
        );
        let _ = fs::remove_dir_all(&root);
    }
}
