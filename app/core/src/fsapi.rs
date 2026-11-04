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
    pub mcp_search_key: Option<String>,
    pub mcp_search_url: Option<String>,
    pub mcp_computer_bot: Option<String>,
    pub mcp_computer_secret: Option<String>,
    pub mcp_computer_url: Option<String>,
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
    pub mcp_search_key: String,
    pub mcp_search_url: String,
    pub has_mcp_search: bool,
    pub mcp_computer_bot: String,
    pub mcp_computer_secret: String,
    pub mcp_computer_url: String,
    pub has_mcp_computer: bool,
}

pub async fn get_keys(State(st): S) -> Json<KeysOut> {
    use crate::secrets::mask;
    let keys = st.keys.read().clone();
    let has = |v: &Option<String>| v.as_deref().map(|s| !s.is_empty()).unwrap_or(false);
    let cb = keys.mcp_computer_bot.clone().unwrap_or_default();
    Json(KeysOut {
        has_minimax: has(&keys.minimax),
        has_nvidia: has(&keys.nvidia),
        minimax: mask(&keys.minimax),
        nvidia: mask(&keys.nvidia),
        max_agents: keys.max_agents.clamp(1, 4),
        nvidia_embed_model: if keys.nvidia_embed_model.is_empty() { "nvidia/nv-embedqa-e5-v5".into() } else { keys.nvidia_embed_model.clone() },
        nvidia_side_model: if keys.nvidia_side_model.is_empty() { "nvidia/nemotron-mini-4b-instruct".into() } else { keys.nvidia_side_model.clone() },
        has_mcp_search: has(&keys.mcp_search_key),
        mcp_search_key: mask(&keys.mcp_search_key),
        mcp_search_url: keys.mcp_search_url.clone().unwrap_or_else(|| crate::mcp::DEFAULT_SEARCH_URL.into()),
        has_mcp_computer: !cb.is_empty() && has(&keys.mcp_computer_secret),
        mcp_computer_bot: cb,
        mcp_computer_secret: mask(&keys.mcp_computer_secret),
        mcp_computer_url: keys.mcp_computer_url.clone().unwrap_or_else(|| crate::mcp::DEFAULT_COMPUTER_URL.into()),
    })
}

/// Store info: where/how secrets are kept, migration state.
pub async fn store_info(State(st): S) -> Json<serde_json::Value> {
    let migrated = st.migrated_file.read().clone().filter(|p| p.exists());
    Json(serde_json::json!({
        "db": st.store.db_path,
        "scheme": st.store.scheme,
        "warning": if st.store.scheme == "dpapi-user" { serde_json::Value::Null } else { serde_json::json!("Dev fallback: AES-GCM with a local key file (not DPAPI). Use Windows for real protection.") },
        "migrated_plaintext": migrated,
        "run_code": st.store.get_setting("run_code").unwrap_or(serde_json::json!("local")),
    }))
}

#[derive(Deserialize)]
pub struct SettingIn { pub key: String, pub value: serde_json::Value }

pub async fn set_setting(State(st): S, Json(b): Json<SettingIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if !["run_code", "omni_config", "ui"].contains(&b.key.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "unknown setting".into()));
    }
    st.store.set_setting(&b.key, &b.value).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn get_setting(State(st): S, Query(q): Query<std::collections::HashMap<String, String>>) -> Json<serde_json::Value> {
    let k = q.get("key").cloned().unwrap_or_default();
    Json(serde_json::json!({"key": k, "value": st.store.get_setting(&k)}))
}

/// Securely wipe the renamed plaintext providers.json.migrated-* file.
pub async fn wipe_migrated(State(st): S) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let p = st.migrated_file.read().clone();
    let Some(p) = p.filter(|p| p.exists()) else { return Ok(Json(serde_json::json!({"ok": true, "detail": "nothing to wipe"}))) };
    crate::secrets::secure_wipe(&p).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    *st.migrated_file.write() = None;
    Ok(Json(serde_json::json!({"ok": true, "wiped": p})))
}

/// Backup export: encrypted blobs only (DPAPI/AES-GCM), never plaintext.
pub async fn export_keys(State(st): S) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let secrets: Vec<_> = st.store.raw_blobs().into_iter()
        .map(|(n, b, s)| serde_json::json!({"name": n, "scheme": s, "blob": b64.encode(b)})).collect();
    let doc = serde_json::json!({
        "format": "omni-keys-backup/1",
        "note": "Encrypted for this Windows user only (DPAPI). Not portable to other accounts.",
        "secrets": secrets,
        "provider_config": st.store.get_setting("provider_config"),
    });
    let dir = st.data_dir.join("data").join("backups");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join(format!("keys-backup-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, serde_json::to_vec_pretty(&doc).unwrap()).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({"ok": true, "path": path, "count": doc["secrets"].as_array().map(|a| a.len()).unwrap_or(0)})))
}

#[derive(Deserialize)]
pub struct ImportIn { pub path: String }

pub async fn import_keys(State(st): S, Json(b): Json<ImportIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text = std::fs::read_to_string(&b.path).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    if v["format"] != "omni-keys-backup/1" { return Err((StatusCode::BAD_REQUEST, "not an OMNI keys backup".into())); }
    let mut n = 0;
    for s in v["secrets"].as_array().cloned().unwrap_or_default() {
        let blob = b64.decode(s["blob"].as_str().unwrap_or("")).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        st.store.put_raw_blob(s["name"].as_str().unwrap_or(""), &blob, s["scheme"].as_str().unwrap_or(""))
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("cannot decrypt (other user/machine?): {e}")))?;
        n += 1;
    }
    if !v["provider_config"].is_null() { let _ = st.store.set_setting("provider_config", &v["provider_config"]); }
    *st.keys.write() = st.store.load_keys();
    Ok(Json(serde_json::json!({"ok": true, "imported": n})))
}

pub async fn set_keys(State(st): S, Json(body): Json<KeysIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut keys = st.keys.read().clone();
    if let Some(v) = body.minimax {
        if !v.is_empty() && !crate::secrets::is_masked(&v) { keys.minimax = Some(v); }
    }
    if let Some(v) = body.nvidia {
        if !v.is_empty() && !crate::secrets::is_masked(&v) { keys.nvidia = Some(v); }
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
    if let Some(v) = body.mcp_search_key {
        if !v.is_empty() && !crate::secrets::is_masked(&v) { keys.mcp_search_key = Some(v); }
    }
    if let Some(v) = body.mcp_search_url {
        keys.mcp_search_url = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = body.mcp_computer_bot {
        keys.mcp_computer_bot = if v.is_empty() { None } else { Some(v) };
    }
    if let Some(v) = body.mcp_computer_secret {
        if !v.is_empty() && !crate::secrets::is_masked(&v) { keys.mcp_computer_secret = Some(v); }
    }
    if let Some(v) = body.mcp_computer_url {
        keys.mcp_computer_url = if v.is_empty() { None } else { Some(v) };
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


#[derive(Deserialize)]
pub struct ClientLogIn {
    pub path: Option<String>,
    pub status: Option<u16>,
    pub kind: Option<String>,
    pub detail: Option<String>,
    pub message: Option<String>,
}

pub async fn client_log(State(st): S, Json(body): Json<ClientLogIn>) -> Json<serde_json::Value> {
    let line = format!(
        "{} client path={} status={} kind={} detail={} message={}\n",
        chrono::Utc::now().to_rfc3339(),
        body.path.unwrap_or_default(),
        body.status.unwrap_or(0),
        body.kind.unwrap_or_default(),
        body.detail.unwrap_or_default().replace("\n", " "),
        body.message.unwrap_or_default().replace("\n", " "),
    );
    let log_path = st.data_dir.join("logs").join("client.log");
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
    }
    tracing::warn!("{line}");
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
pub struct MkdirIn {
    pub path: String,
}

pub async fn mkdir(State(st): S, Json(body): Json<MkdirIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let path = PathBuf::from(&body.path);
    let root = st.project_root.read().clone();
    guardrails::assert_can_write(&path, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    std::fs::create_dir_all(&path).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true, "path": path.display().to_string() })))
}

#[derive(Deserialize)]
pub struct RenameIn {
    pub from: String,
    pub to: String,
}

pub async fn rename_path(State(st): S, Json(body): Json<RenameIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let from = PathBuf::from(&body.from);
    let to = PathBuf::from(&body.to);
    let root = st.project_root.read().clone();
    guardrails::assert_can_write(&from, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    guardrails::assert_can_write(&to, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    std::fs::rename(&from, &to).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true, "from": body.from, "to": body.to })))
}

#[derive(Deserialize)]
pub struct CopyIn {
    pub from: String,
    pub to: String,
}

pub async fn copy_path(State(st): S, Json(body): Json<CopyIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let from = PathBuf::from(&body.from);
    let to = PathBuf::from(&body.to);
    let root = st.project_root.read().clone();
    guardrails::assert_can_write(&to, root.as_deref(), &st.data_dir)
        .map_err(|e| (StatusCode::FORBIDDEN, e.0))?;
    if from.is_dir() {
        return Err((StatusCode::BAD_REQUEST, "directory copy not supported yet — copy files".into()));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    std::fs::copy(&from, &to).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct TermIn {
    pub cmd: String,
    pub cwd: Option<String>,
}

pub async fn term_exec(State(st): S, Json(body): Json<TermIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cmd = body.cmd.trim();
    if cmd.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty command".into()));
    }
    // Block obviously dangerous patterns
    let lower = cmd.to_lowercase();
    for bad in ["rm -rf /", "format ", "mkfs", ":(){", "shutdown", "reboot"] {
        if lower.contains(bad) {
            return Err((StatusCode::FORBIDDEN, "command blocked by guardrails".into()));
        }
    }
    let mut cwd = body
        .cwd
        .map(PathBuf::from)
        .or_else(|| st.project_root.read().clone())
        .unwrap_or_else(|| st.data_dir.clone());
    if !cwd.exists() {
        cwd = st.data_dir.clone();
    }
    // cd builtin
    if lower.starts_with("cd ") || lower == "cd" {
        let rest = cmd[2..].trim();
        let next = if rest.is_empty() || rest == "~" {
            dirs::home_dir().unwrap_or(cwd.clone())
        } else {
            let p = PathBuf::from(rest);
            if p.is_absolute() { p } else { cwd.join(p) }
        };
        let canon = next.canonicalize().unwrap_or(next);
        return Ok(Json(serde_json::json!({
            "ok": true,
            "stdout": "",
            "stderr": "",
            "code": 0,
            "cwd": canon.display().to_string(),
        })));
    }

    #[cfg(windows)]
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", cmd])
        .current_dir(&cwd)
        .output();
    #[cfg(not(windows))]
    let output = std::process::Command::new("bash")
        .args(["-lc", cmd])
        .current_dir(&cwd)
        .output();

    let output = output.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({
        "ok": output.status.success(),
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        "code": output.status.code().unwrap_or(1),
        "cwd": cwd.display().to_string(),
    })))
}
