use crate::guardrails;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

pub struct AppState {
    pub mode: RwLock<String>,
    pub data_dir: PathBuf,
    pub project_root: RwLock<Option<PathBuf>>,
    pub tree: RwLock<Option<TreeNode>>,
    pub keys: RwLock<ProviderKeys>,
    pub rate: RwLock<RateCounters>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct ProviderKeys {
    pub minimax: Option<String>,
    pub nvidia: Option<String>,
}

#[derive(Default)]
pub struct RateCounters {
    pub minimax_hour_tools: u32,
    pub nvidia_min_tools: u32,
    pub hour_bucket: i64,
    pub min_bucket: i64,
}

impl AppState {
    pub fn new(mode: &str, data_dir: PathBuf, project: Option<PathBuf>) -> anyhow::Result<Self> {
        let keys = load_keys(&data_dir);
        let state = Self {
            mode: RwLock::new(mode.to_string()),
            data_dir,
            project_root: RwLock::new(None),
            tree: RwLock::new(None),
            keys: RwLock::new(keys),
            rate: RwLock::new(RateCounters::default()),
        };
        if let Some(p) = project {
            state.open_project(&p)?;
        }
        Ok(state)
    }

    pub fn open_project(&self, path: &Path) -> anyhow::Result<TreeNode> {
        let canon = std::fs::canonicalize(path)?;
        guardrails::assert_not_system(&canon)?;
        let tree = build_tree(&canon, 0, 6)?;
        *self.project_root.write() = Some(canon.clone());
        *self.tree.write() = Some(tree.clone());
        // Ensure harness scaffold files if missing (skip fixture demos)
        if !canon.join(".omni-fixture").exists() {
            for name in ["plan.md", "agents.md", "instructions.txt"] {
                let f = canon.join(name);
                if !f.exists() {
                    let stub = match name {
                        "plan.md" => "# Plan\n\n_Awaiting first harness turn._\n",
                        "agents.md" => "# Agents\n\nDefault: coding-expert\n",
                        _ => "# Instructions\n\nProject instructions for OMNI workers.\n",
                    };
                    std::fs::write(f, stub)?;
                }
            }
        }
        Ok(tree)
    }

    pub fn keys_path(&self) -> PathBuf {
        self.data_dir.join("keys").join("providers.json")
    }
}

pub fn load_keys(data_dir: &Path) -> ProviderKeys {
    let p = data_dir.join("keys").join("providers.json");
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_keys(state: &AppState, keys: &ProviderKeys) -> anyhow::Result<()> {
    let p = state.keys_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, serde_json::to_string_pretty(keys)?)?;
    Ok(())
}

fn build_tree(path: &Path, depth: usize, max_depth: usize) -> anyhow::Result<TreeNode> {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if path.is_file() {
        return Ok(TreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            kind: "file".into(),
            children: None,
        });
    }
    let mut children = Vec::new();
    if depth < max_depth {
        let mut entries: Vec<_> = std::fs::read_dir(path)?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| {
            (
                e.path().is_file(),
                e.file_name().to_string_lossy().to_lowercase(),
            )
        });
        for e in entries {
            let p = e.path();
            let n = e.file_name().to_string_lossy().to_string();
            if n == ".git" || n == "node_modules" || n == "target" || n == "dist" || n.starts_with('.') && n != ".omni" && n != ".vscode" && n != ".gitignore" {
                // keep .vscode / .omni / .gitignore; skip other dot dirs
                if n.starts_with('.') && n != ".vscode" && n != ".omni" && n != ".gitignore" {
                    continue;
                }
            }
            if n == "node_modules" || n == "target" || n == ".git" {
                continue;
            }
            match build_tree(&p, depth + 1, max_depth) {
                Ok(node) => children.push(node),
                Err(_) => continue,
            }
        }
    }
    Ok(TreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        kind: "dir".into(),
        children: Some(children),
    })
}

impl AppState {
    pub fn drift_mode(&self) -> String {
        std::fs::read_to_string(self.data_dir.join("drift_mode.txt")).unwrap_or_else(|_| "warn".into()).trim().to_string()
    }
    pub fn set_drift_mode(&self, mode: &str) {
        let _ = std::fs::write(self.data_dir.join("drift_mode.txt"), mode);
    }
}
