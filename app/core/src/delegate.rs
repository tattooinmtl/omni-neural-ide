use crate::ai::Msg;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct DelegateIn {
    pub task: String,
    pub from: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DelegateOut {
    pub task_id: String,
    pub status: String,
    pub message: String,
    pub coding_reply: String,
    pub files_written: Vec<String>,
}

/// Omni → Coding Agent handoff. Acquires a MiniMax pool slot, runs the Coding Agent,
/// writes any fenced files into the project, and returns a real task id.
pub async fn delegate_to_coding_agent(
    State(st): State<Arc<AppState>>,
    Json(body): Json<DelegateIn>,
) -> Result<Json<DelegateOut>, (StatusCode, String)> {
    let task = body.task.trim().to_string();
    if task.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty task".into()));
    }
    let task_id = Uuid::new_v4().to_string();
    let _permit = st.pool.acquire().await;
    crate::ai::bump_minimax_rate(&st)?;
    let keys = st.keys.read().clone();
    let key = keys.minimax.filter(|s| !s.is_empty()).ok_or((
        StatusCode::UNAUTHORIZED,
        "MiniMax API key not set — enter it in Settings → Providers".into(),
    ))?;

    let system = "You are the Coding Agent inside OMNI-CODE. Complete the user's task with concrete files. \
When you create or edit a file, emit a markdown fence like:\n```html file=\"towerdefense.html\"\n...content...\n```\n\
Prefer a single self-contained HTML file when asked for HTML-only. Be concise outside fences.";
    let from = body.from.unwrap_or_else(|| "Omni".into());
    let user = format!("From {from}: {task}");
    let msgs = vec![Msg { role: "user".into(), content: user.clone() }];
    let caps = crate::agent_run::Caps::coding();
    let run = st.runs.start("delegate-coding");
    let run_id = run.id.clone();
    let coding_reply = match crate::agent_run::with_caps_cancel(&run, caps, &st.data_dir, || {
        let key = key.clone();
        let system = system.to_string();
        let msgs = msgs.clone();
        let run = run.clone();
        let mt = caps.max_output_tokens.min(2048);
        async move { crate::ai::call_minimax_opts_cancel(&key, &system, &msgs, mt, 0.4, &run).await }
    }).await {
        Ok(c) => c,
        Err((code, msg)) => {
            st.runs.finish(&run_id);
            return Err((code, msg));
        }
    };
    st.runs.finish(&run_id);

    let files = extract_and_write_files(&st, &coding_reply)?;
    {
        let mut q = st.delegate_log.write();
        q.push(DelegateOut {
            task_id: task_id.clone(),
            status: "completed".into(),
            message: format!("Coding Agent finished task {task_id}"),
            coding_reply: coding_reply.clone(),
            files_written: files.clone(),
        });
        if q.len() > 20 {
            let n = q.len() - 20;
            q.drain(0..n);
        }
    }

    Ok(Json(DelegateOut {
        task_id: task_id.clone(),
        status: "completed".into(),
        message: if files.is_empty() {
            format!("Sent to Coding Agent (task {task_id}).")
        } else {
            format!("Coding Agent finished — wrote {}.", files.join(", "))
        },
        coding_reply,
        files_written: files,
    }))
}

pub fn extract_and_write_files_pub(st: &AppState, reply: &str) -> Result<Vec<String>, (StatusCode, String)> {
    extract_and_write_files(st, reply)
}

fn extract_and_write_files(st: &AppState, reply: &str) -> Result<Vec<String>, (StatusCode, String)> {
    let root = st.project_root.read().clone();
    let Some(root) = root else {
        // still allow writing under data sandbox when no project
        let sandbox = st.data_dir.join("sandbox");
        std::fs::create_dir_all(&sandbox).ok();
        return write_fences(&sandbox, reply);
    };
    write_fences(&root, reply)
}

fn write_fences(root: &std::path::Path, reply: &str) -> Result<Vec<String>, (StatusCode, String)> {
    let re = Regex::new(r#"(?s)```([a-zA-Z0-9_+-]*)[^\n]*file\s*=\s*"([^"]+)"\n(.*?)```"#).unwrap();
    let re2 = Regex::new(r"(?s)```([a-zA-Z0-9_+-]*)\n(.*?)```").unwrap();
    let mut written = Vec::new();
    let mut matched = false;
    for cap in re.captures_iter(reply) {
        matched = true;
        let fname = cap.get(2).unwrap().as_str().trim();
        let content = cap.get(3).unwrap().as_str();
        let path = sanitize_rel(root, fname)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&path, content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        written.push(path.to_string_lossy().to_string());
    }
    if !matched {
        // Fallback: single html/js fence → towerdefense.html if content looks like HTML game
        if let Some(cap) = re2.captures(reply) {
            let lang = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let content = cap.get(2).unwrap().as_str();
            if lang.eq_ignore_ascii_case("html") || content.contains("<html") || content.contains("<!DOCTYPE") {
                let fname = "towerdefense.html";
                let path = root.join(fname);
                std::fs::write(&path, content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                written.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(written)
}

fn sanitize_rel(root: &std::path::Path, fname: &str) -> Result<std::path::PathBuf, (StatusCode, String)> {
    let clean = fname.replace('\\', "/");
    if clean.contains("..") || clean.starts_with('/') || clean.starts_with('~') {
        return Err((StatusCode::BAD_REQUEST, "invalid path".into()));
    }
    Ok(root.join(clean))
}

pub async fn list_delegates(State(st): State<Arc<AppState>>) -> Json<Vec<DelegateOut>> {
    Json(st.delegate_log.read().clone())
}
