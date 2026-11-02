//! Drift checks for one harness step.

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
        let Some(path) = entry.path() else { continue; };
        let path = path.replace('\\', "/");
        if scope.allows_path(&path) { continue; }
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
