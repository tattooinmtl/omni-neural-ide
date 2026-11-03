use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct SlashIn {
    pub cmd: String,
    pub args: String,
}

const SLASH: &[&str] = &[
    "plan", "checkpoint", "steer", "note", "audit", "rollback", "eval", "diff", "accept",
    "reject", "tools", "skills", "status", "create-skill", "create-tool", "update",
];

pub async fn slash(State(st): State<Arc<AppState>>, Json(body): Json<SlashIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cmd = body.cmd.trim().trim_start_matches('/').to_lowercase();
    if !SLASH.contains(&cmd.as_str()) {
        return Ok(Json(serde_json::json!({
            "ok": false,
            "message": format!("Unknown command /{cmd}. Available: {}", SLASH.iter().map(|s| format!("/{s}")).collect::<Vec<_>>().join(" ")),
        })));
    }
    let root = st.project_root.read().clone();
    let msg = match cmd.as_str() {
        "plan" => {
            if let Some(r) = &root {
                let plan = r.join("plan.md");
                let content = std::fs::read_to_string(&plan).unwrap_or_else(|_| "(empty plan.md)".into());
                format!("## plan.md\n\n{content}")
            } else {
                "No project open. Open a folder first.".into()
            }
        }
        "status" => {
            format!(
                "Mode: {}\nProject: {}\nMiniMax key: {}\nNVIDIA key: {}",
                st.mode.read(),
                root.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "(none)".into()),
                st.keys.read().minimax.as_ref().map(|_| "set").unwrap_or("missing"),
                st.keys.read().nvidia.as_ref().map(|_| "set").unwrap_or("missing"),
            )
        }
        "checkpoint" => {
            if let Some(r) = &root {
                let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                let dir = st.data_dir.join("checkpoints").join(stamp.to_string());
                std::fs::create_dir_all(&dir).ok();
                let _ = copy_dir_limited(r, &dir, 3);
                format!("Checkpoint saved to {}", dir.display())
            } else {
                "No project open.".into()
            }
        }
        "note" => {
            if let Some(r) = &root {
                let diary = r.join("nim_diary.md");
                use std::io::Write;
                let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&diary)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                writeln!(f, "\n## {}\n{}\n", chrono::Utc::now().to_rfc3339(), body.args)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                format!("Noted to nim_diary.md")
            } else { "No project open.".into() }
        }
        "diff" => {
            if let Some(r) = &root {
                let out = std::process::Command::new("git").args(["diff","--stat"]).current_dir(r).output();
                match out {
                    Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
                    Err(e) => format!("git diff failed: {e}"),
                }
            } else { "No project open.".into() }
        }
        "audit" => {
            // read-only machine audit
            let home = dirs::home_dir().map(|p| p.display().to_string()).unwrap_or_default();
            format!("Read-only audit\nHome: {home}\nData: {}\nOS: {}", st.data_dir.display(), std::env::consts::OS)
        }
        "update" => {
            // Signal UI to run /api/update/apply; also attempt a check here for message.
            match crate::update::check(axum::extract::State(st.clone())).await {
                Ok(j) => {
                    let info = j.0;
                    if info.available {
                        format!("Update available: {} → {}. Applying… (UI will restart)", info.current, info.latest.unwrap_or_default())
                    } else {
                        format!("Already on latest ({})", info.current)
                    }
                }
                Err((_, e)) => format!("Update check failed: {e}"),
            }
        }
        "accept" | "reject" | "steer" | "eval" | "rollback" | "tools" | "skills" | "create-skill" | "create-tool" => {
            format!("/{cmd} queued in harness loop. Args: {}", if body.args.is_empty() { "(none)" } else { &body.args })
        }
        _ => format!("/{cmd} ok"),
    };
    Ok(Json(serde_json::json!({ "ok": true, "message": msg })))
}

fn copy_dir_limited(src: &std::path::Path, dst: &std::path::Path, depth: usize) -> std::io::Result<()> {
    if depth == 0 { return Ok(()); }
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let n = e.file_name();
        let ns = n.to_string_lossy();
        if ns == ".git" || ns == "node_modules" || ns == "target" { continue; }
        let to = dst.join(&n);
        if e.path().is_dir() {
            copy_dir_limited(&e.path(), &to, depth - 1)?;
        } else if e.path().is_file() {
            let _ = std::fs::copy(e.path(), to);
        }
    }
    Ok(())
}


#[derive(Deserialize)]
pub struct RunIn { pub goal: String }

pub async fn run_loop(State(st): State<Arc<AppState>>, Json(body): Json<RunIn>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // intake → context → requirements → scaffold → turn → one retry → drift → review
    let root = st.project_root.read().clone().ok_or((StatusCode::BAD_REQUEST, "open a project first".into()))?;
    let plan = root.join("plan.md");
    let mut plan_txt = std::fs::read_to_string(&plan).unwrap_or_default();
    plan_txt.push_str(&format!("\n\n## Intake {}\nGoal: {}\n", chrono::Utc::now().to_rfc3339(), body.goal));
    std::fs::write(&plan, &plan_txt).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // scaffold already ensured by open_project
    let diff = std::process::Command::new("git").args(["diff","--stat"]).current_dir(&root).output();
    let diff_s = diff.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let drift_mode = st.drift_mode();
    let paused = !diff_s.trim().is_empty() && drift_mode == "pause";
    Ok(Json(serde_json::json!({
        "ok": true,
        "phase": if paused { "paused" } else { "review" },
        "plan": plan_txt,
        "diff": diff_s,
        "driftMode": drift_mode,
        "message": if paused { "Drift pause — review required" } else { "Awaiting Accept/Reject/Continue" }
    })))
}

#[derive(Deserialize)]
pub struct DriftIn { pub mode: String }

pub async fn set_drift_mode(State(st): State<Arc<AppState>>, Json(body): Json<DriftIn>) -> Json<serde_json::Value> {
    let m = if body.mode == "pause" { "pause" } else { "warn" };
    st.set_drift_mode(m);
    Json(serde_json::json!({ "ok": true, "mode": m }))
}
