//! Drift checks for one harness step.
//!
//! The primary check compares written paths and tool names with the step scope.
//! The secondary check reads `git2` status inside the workspace repository.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DriftFlag {
    UnexpectedPath { path: String },
    DisallowedTool { tool: String },
    GitDirty { path: String },
}

impl DriftFlag {
    pub fn label(&self) -> String {
        match self {
            Self::UnexpectedPath { path } => format!("unexpected file: {path}"),
            Self::DisallowedTool { tool } => format!("tool not on allow-list: {tool}"),
            Self::GitDirty { path } => format!("git dirty: {path}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Scope {
    pub expected_files: BTreeSet<String>,
    pub allowed_globs: Vec<String>,
    pub allowed_tools: BTreeSet<String>,
}

impl Scope {
    /// Files the harness and the scribe are allowed to touch in one run.
    pub fn standard() -> Self {
        let mut expected_files = BTreeSet::new();
        for name in ["plan.md", "agents.md", "instructions.txt", "notes.md", "out/result.txt"] {
            expected_files.insert((*name).to_string());
        }
        let mut allowed_tools = BTreeSet::new();
        for tool in ["read_file", "write_file", "harness"] {
            allowed_tools.insert((*tool).to_string());
        }
        Self {
            expected_files,
            allowed_globs: vec!["out/**".into(), ".omni/**".into(), "notes.md".into()],
            allowed_tools,
        }
    }

    pub fn allows_path(&self, relative: &str) -> bool {
        if self.expected_files.contains(relative) {
            return true;
        }
        self.allowed_globs.iter().any(|pattern| glob_matches(pattern, relative))
    }
}

pub fn primary(scope: &Scope, written: &[String], tools: &[String]) -> Vec<DriftFlag> {
    let mut flags = Vec::new();
    for path in written {
        if !scope.allows_path(path) {
            flags.push(DriftFlag::UnexpectedPath { path: path.clone() });
        }
    }
    for tool in tools {
        if !scope.allowed_tools.contains(tool) {
            flags.push(DriftFlag::DisallowedTool { tool: tool.clone() });
        }
    }
    flags
}

/// Dirty paths in `workspace` that this step did not allow.
///
/// Opens only a repository whose root is the workspace. Discovering a parent
/// repository would flag the IDE's own sources.
pub fn git_status(workspace: &Path, scope: &Scope) -> Vec<DriftFlag> {
    let Ok(repo) = git2::Repository::open(workspace) else {
        return Vec::new();
    };
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let Ok(statuses) = repo.statuses(Some(&mut options)) else {
        return Vec::new();
    };
    let mut flags = Vec::new();
    for entry in &statuses {
        let Some(path) = entry.path() else {
            continue;
        };
        let path = path.replace('\\', "/");
        if scope.allows_path(&path) {
            continue;
        }
        flags.push(DriftFlag::GitDirty { path });
    }
    flags
}

pub fn ensure_repo(workspace: &Path) -> Result<(), String> {
    if git2::Repository::open(workspace).is_ok() {
        return Ok(());
    }
    git2::Repository::init(workspace).map_err(|err| err.to_string())?;
    Ok(())
}

fn glob_matches(pattern: &str, path: &str) -> bool {
    // `out/**` must match files directly inside `out/`, which some glob builds
    // only do when the directory prefix is tested on its own.
    if let Some(prefix) = pattern.strip_suffix("/**") {
        if path == prefix || path.starts_with(&format!("{prefix}/")) {
            return true;
        }
    }
    glob::Pattern::new(pattern).is_ok_and(|compiled| compiled.matches(path))
}

pub fn safe_relative(relative: &str) -> Result<PathBuf, String> {
    let relative = relative.replace('\\', "/");
    if relative.starts_with('/') || relative.contains(':') {
        return Err("path must stay inside the workspace".into());
    }
    if relative.split('/').any(|part| part == ".." || part.is_empty()) {
        return Err("path must stay inside the workspace".into());
    }
    Ok(PathBuf::from(&relative))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn primary_flags_unexpected_files_and_tools() {
        let scope = Scope::standard();
        let flags = primary(&scope, &["sneak.txt".into(), "plan.md".into()], &["delete_repo".into()]);
        assert!(flags.iter().any(|flag| matches!(flag, DriftFlag::UnexpectedPath { path } if path == "sneak.txt")));
        assert!(flags.iter().any(|flag| matches!(flag, DriftFlag::DisallowedTool { tool } if tool == "delete_repo")));
        assert!(!flags.iter().any(|flag| matches!(flag, DriftFlag::UnexpectedPath { path } if path == "plan.md")));
    }

    #[test]
    fn glob_allows_nested_output() {
        let scope = Scope::standard();
        assert!(scope.allows_path("out/result.txt"));
        assert!(scope.allows_path(".omni/checkpoints/1.json"));
    }

    #[test]
    fn git_flags_only_paths_outside_the_scope() {
        let root = std::env::temp_dir().join(format!("omni-drift-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("out")).unwrap();
        ensure_repo(&root).unwrap();
        fs::write(root.join("out").join("result.txt"), "ok").unwrap();
        fs::write(root.join("sneak.txt"), "no").unwrap();
        let flags = git_status(&root, &Scope::standard());
        assert!(flags.iter().any(|flag| matches!(flag, DriftFlag::GitDirty { path } if path == "sneak.txt")));
        assert!(!flags.iter().any(|flag| matches!(flag, DriftFlag::GitDirty { path } if path.starts_with("out/"))));
        let _ = fs::remove_dir_all(&root);
    }
}
