//! Path guardrails enforced before any write.

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
    match request.action {
        Action::Read => if allowed_root || is_within(&path, &policy.install_root) { Verdict::Allow } else { Verdict::OutsideAllowList },
        Action::Write | Action::Delete => {
            if !allowed_root { return Verdict::OutsideAllowList; }
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
    roots.iter().any(|root| is_within(path, root))
}

fn is_open(policy: &Policy, path: &Path) -> bool {
    policy.open_files.iter().any(|open| same_file(path, &normalize(open)))
}

fn same_file(left: &Path, right: &Path) -> bool {
    norm_key(left) == norm_key(right)
}

fn system_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\Windows"),
        PathBuf::from(r"C:\Program Files"),
        PathBuf::from(r"C:\Program Files (x86)"),
    ]
}

pub fn normalize(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return strip_verbatim(canonical);
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
    strip_verbatim(path.to_path_buf()).to_string_lossy().replace('/', "\\").to_ascii_lowercase()
}
