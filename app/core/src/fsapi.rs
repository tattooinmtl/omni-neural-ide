use crate::guardrails;
use crate::state::{save_keys, AppState, TreeNode};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

type S = State<Arc<AppState>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub ok: bool,
    pub mode: String,
}

pub async fn health(State(st): S) -> Json<Health> {
    Json(Health {
        ok: true,
        mode: st.mode.read().clone(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOut {
    pub mode: String,
    pub project_root: Option<String>,
    pub models: Vec<&'static str>,
    pub has_minimax: bool,
    pub has_nvidia: bool,
}

pub async fn config(State(st): S) -> Json<ConfigOut> {
    let keys = st.keys.read().clone();
    Json(ConfigOut {
        mode: st.mode.read().clone(),
        project_root: st.project_root.read().as_ref().map(|p| p.display().to_string()),
        models: vec!["Omni Ultra 1.2", "MiniMax M3.1 Flash", "NVIDIA Nemotron 3.5"],
        has_minimax: keys.minimax.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
        has_nvidia: keys.nvidia.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
    })
}

#[derive(Deserialize)]
pub struct KeysIn {
    pub minimax: Option<String>,
    pub nvidia: Option<String>,
    pub max_agents: Option<u32>,
    pub nvidia_embed_model: Option<String>,
    pub nvidia_side_model: Option<String>,
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysOut {
    pub minimax: String,
    pub nvidia: String,
    pub has_minimax: bool,
    pub has_nvidia: bool,
    pub max_agents: u32,
    pub nvidia_embed_model: String,
    pub nvidia_side_model: String,
}

pub async fn get_keys(State(st): S) -> Json<KeysOut> {
    let keys = st.keys.read().clone();
    let mm = keys.minimax.clone().unwrap_or_default();
    let nv = keys.nvidia.clone().unwrap_or_default();
    Json(KeysOut {
        has_minimax: !mm.is_empty(),
        has_nvidia: !nv.is_empty(),
        minimax: mm,
        nvidia: nv,
        max_agents: keys.max_agents.clamp(1, 4),
        nvidia_embed_model: if keys.nvidia_embed_model.is_empty() {
            "nvidia/nv-embedqa-e5-v5".into()
        } else {
            keys.nvidia_embed_model
        },
        nvidia_side_model: if keys.nvidia_side_model.is_empty() {
            "nvidia/nemotron-mini-4b-instruct".into()
        } else {
            keys.nvidia_side_model
        },
    })
}

pub async fn set_keys(State(st): S, Json(body): Json<KeysIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut keys = st.keys.read().clone();
    if let Some(v) = body.minimax {
        if !v.is_empty() { keys.minimax = Some(v); }
    }
    if let Some(v) = body.nvidia {
        if !v.is_empty() { keys.nvidia = Some(v); }
    }
    if let Some(v) = body.max_agents {
        keys.max_agents = v.clamp(1, 4);
        st.pool.set_max(keys.max_agents as usize).await;
    }
    if let Some(v) = body.nvidia_embed_model {
        if !v.is_empty() { keys.nvidia_embed_model = v; }
    }
    if let Some(v) = body.nvidia_side_model {
        if !v.is_empty() { keys.nvidia_side_model = v; }
    }
    save_keys(&st, &keys).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    *st.keys.write() = keys;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct PathQ {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOut {
    pub entries: Vec<TreeNode>,
}

pub async fn list_dir(State(st): S, Query(q): Query<PathQ>) -> Result<Json<ListOut>, (StatusCode, String)> {
    let path = PathBuf::from(&q.path);
    guardrails::assert_not_system(&path).map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&path).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))? {
        let e = e.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        let p = e.path();
        let kind = if p.is_dir() { "dir" } else { "file" };
        entries.push(TreeNode {
            name: e.file_name().to_string_lossy().to_string(),
            path: p.to_string_lossy().to_string(),
            kind: kind.into(),
            children: None,
        });
    }
    let _ = &st;
    Ok(Json(ListOut { entries }))
}

fn language_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "rs" => "rust",
        "go" => "go",
        "md" => "markdown",
        "json" => "json",
        "css" => "css",
        "html" => "html",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "sh" => "shell",
        "ps1" => "powershell",
        _ => "plaintext",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOut {
    pub path: String,
    pub content: String,
    pub language: String,
}

pub async fn read_file(State(st): S, Query(q): Query<PathQ>) -> Result<Json<ReadOut>, (StatusCode, String)> {
    let path = PathBuf::from(&q.path);
    guardrails::assert_not_system(&path).map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    // binary guard
    if let Err(e) = guardrails::assert_can_write(&path, st.project_root.read().as_deref(), &st.data_dir) {
        // reuse binary extension check by attempting write-guard rules for ext only
        if e.0.contains("binary") {
            return Err((StatusCode::UNSUPPORTED_MEDIA_TYPE, e.0));
        }
    }
    let content = std::fs::read_to_string(&path).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(ReadOut {
        language: language_for(&path).into(),
        path: q.path,
        content,
    }))
}

#[derive(Deserialize)]
pub struct WriteIn {
    pub path: String,
    pub content: String,
}

pub async fn write_file(State(st): S, Json(body): Json<WriteIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = PathBuf::from(&body.path);
    let root = st.project_root.read().clone();
    guardrails::assert_can_write(&path, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    std::fs::write(&path, body.content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut drift = serde_json::Value::Null;
    if let Some(root) = st.project_root.read().clone() {
        if let Ok(o) = std::process::Command::new("git").args(["diff","--stat"]).current_dir(&root).output() {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            if !s.trim().is_empty() {
                drift = serde_json::json!({ "mode": st.drift_mode(), "stat": s });
            }
        }
    }
    Ok(Json(serde_json::json!({ "ok": true, "drift": drift })))
}

#[derive(Deserialize)]
pub struct OpenIn {
    pub path: String,
}

pub async fn open_folder(State(st): S, Json(body): Json<OpenIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = PathBuf::from(&body.path);
    let tree = st.open_project(&path).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(serde_json::json!({
        "root": path.canonicalize().unwrap_or(path).to_string_lossy(),
        "tree": tree,
    })))
}

pub async fn tree(State(st): S) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "root": st.project_root.read().as_ref().map(|p| p.display().to_string()),
        "tree": st.tree.read().clone(),
    }))
}

#[derive(Deserialize)]
pub struct DeleteIn {
    pub path: String,
    pub confirm: bool,
}

pub async fn delete_path(State(st): S, Json(body): Json<DeleteIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = PathBuf::from(&body.path);
    guardrails::assert_can_delete(&path, body.confirm).map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    let root = st.project_root.read().clone();
    guardrails::assert_can_write(&path, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
