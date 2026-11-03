//! In-flight agent run control: cancel, caps, watchdog status, logging.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub max_output_tokens: u32,
    pub wall_ms: u64,
    pub max_tool_iters: u32,
    pub thinking_token_budget: u32,
    pub idle_watchdog_ms: u64,
}

impl Caps {
    pub fn coding() -> Self {
        Self {
            max_output_tokens: 4096,
            wall_ms: 120_000,
            max_tool_iters: 4,
            thinking_token_budget: 2048,
            idle_watchdog_ms: 45_000,
        }
    }
    pub fn from_omni_depth(depth: &str, max_tokens: u32, timeout_ms: u64) -> Self {
        let (think, wall_extra) = match depth {
            "off" => (0, 0),
            "low" => (256, 0),
            "medium" => (768, 15_000),
            "high" => (2048, 45_000),
            _ => (256, 0),
        };
        Self {
            max_output_tokens: max_tokens.clamp(64, 4096),
            wall_ms: timeout_ms.clamp(5_000, 180_000).saturating_add(wall_extra),
            max_tool_iters: 3,
            thinking_token_budget: think,
            idle_watchdog_ms: 30_000,
        }
    }
}

#[derive(Clone)]
pub struct RunHandle {
    pub id: String,
    pub cancel: Arc<AtomicBool>,
    pub started: Instant,
    pub tokens_out: Arc<AtomicU64>,
    pub last_token_at: Arc<Mutex<Instant>>,
    pub label: String,
}

impl RunHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
    pub fn bump_tokens(&self, n: u64) {
        self.tokens_out.fetch_add(n, Ordering::SeqCst);
        *self.last_token_at.lock() = Instant::now();
    }
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub struct RunRegistry {
    active: Mutex<HashMap<String, RunHandle>>,
    current: Mutex<Option<String>>,
}

impl RunRegistry {
    pub fn start(&self, label: &str) -> RunHandle {
        let id = Uuid::new_v4().to_string();
        let h = RunHandle {
            id: id.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            tokens_out: Arc::new(AtomicU64::new(0)),
            last_token_at: Arc::new(Mutex::new(Instant::now())),
            label: label.to_string(),
        };
        self.active.lock().insert(id.clone(), h.clone());
        *self.current.lock() = Some(id.clone());
        h
    }

    pub fn finish(&self, id: &str) {
        self.active.lock().remove(id);
        let mut cur = self.current.lock();
        if cur.as_deref() == Some(id) {
            *cur = None;
        }
    }

    pub fn stop_current(&self) -> Option<String> {
        let id = self.current.lock().clone()?;
        if let Some(h) = self.active.lock().get(&id) {
            h.request_cancel();
        }
        Some(id)
    }

    pub fn stop(&self, id: &str) -> bool {
        if let Some(h) = self.active.lock().get(id) {
            h.request_cancel();
            true
        } else {
            false
        }
    }

    pub fn status(&self) -> RunStatus {
        let cur = self.current.lock().clone();
        if let Some(id) = cur {
            if let Some(h) = self.active.lock().get(&id).cloned() {
                let elapsed_ms = h.started.elapsed().as_millis() as u64;
                let tokens = h.tokens_out.load(Ordering::SeqCst);
                let idle_ms = h.last_token_at.lock().elapsed().as_millis() as u64;
                // Rough MiniMax-ish estimate ~$0.20 / 1M output tokens
                let cost_usd = (tokens as f64) * 0.0000002;
                let cancelled = h.is_cancelled();
                return RunStatus {
                    active: true,
                    run_id: Some(id),
                    label: Some(h.label.clone()),
                    elapsed_ms,
                    tokens_out: tokens,
                    idle_ms,
                    cost_usd,
                    cancelled,
                };
            }
        }
        RunStatus {
            active: false,
            run_id: None,
            label: None,
            elapsed_ms: 0,
            tokens_out: 0,
            idle_ms: 0,
            cost_usd: 0.0,
            cancelled: false,
        }
    }
}

#[derive(Serialize, Clone)]
pub struct RunStatus {
    pub active: bool,
    pub run_id: Option<String>,
    pub label: Option<String>,
    pub elapsed_ms: u64,
    pub tokens_out: u64,
    pub idle_ms: u64,
    pub cost_usd: f64,
    pub cancelled: bool,
}

#[derive(Deserialize)]
pub struct StopIn {
    pub run_id: Option<String>,
}

use axum::{extract::State, http::StatusCode, Json};
use crate::state::AppState;

pub async fn stop_run(
    State(st): State<Arc<AppState>>,
    Json(body): Json<StopIn>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let id = if let Some(rid) = body.run_id.as_deref().filter(|s| !s.is_empty()) {
        if st.runs.stop(rid) {
            log_event(&st.data_dir, &format!("stop requested run_id={rid}"));
            rid.to_string()
        } else {
            return Ok(Json(serde_json::json!({"ok": false, "detail": "run not found"})));
        }
    } else if let Some(id) = st.runs.stop_current() {
        log_event(&st.data_dir, &format!("stop requested current run_id={id}"));
        id
    } else {
        return Ok(Json(serde_json::json!({"ok": true, "detail": "nothing running"})));
    };
    Ok(Json(serde_json::json!({"ok": true, "run_id": id, "detail": "cancel signaled — provider stream aborting"})))
}

pub async fn run_status(State(st): State<Arc<AppState>>) -> Json<RunStatus> {
    Json(st.runs.status())
}

pub fn log_event(data_dir: &PathBuf, msg: &str) {
    let logs = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let line = format!("[{}] {}\n", chrono::Utc::now().to_rfc3339(), msg);
    let path = logs.join("agent-watchdog.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = f.write_all(line.as_bytes());
    }
    tracing::info!(target: "agent_run", "{msg}");
}

pub fn cancelled_err() -> (StatusCode, String) {
    (StatusCode::CONFLICT, "Stopped — generation cancelled.".into())
}

pub fn capped_msg(kind: &str) -> String {
    format!("Hit {kind} cap — stopped to protect the UI and your token budget.")
}

pub async fn with_caps_cancel<T, E, F, Fut>(
    run: &RunHandle,
    caps: Caps,
    data_dir: &PathBuf,
    fut: F,
) -> Result<T, (StatusCode, String)>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: ToString,
{
    if run.is_cancelled() {
        return Err(cancelled_err());
    }
    let wall = Duration::from_millis(caps.wall_ms);
    let idle = Duration::from_millis(caps.idle_watchdog_ms);
    let started = Instant::now();
    let result = tokio::select! {
        biased;
        _ = async {
            loop {
                tokio::time::sleep(Duration::from_millis(200)).await;
                if run.is_cancelled() {
                    break;
                }
                if started.elapsed() > wall {
                    break;
                }
                let idle_for = run.last_token_at.lock().elapsed();
                // Only enforce idle watchdog after we've started receiving (tokens > 0)
                // OR after half the wall clock with zero progress.
                let tokens = run.tokens_out.load(Ordering::SeqCst);
                if tokens > 0 && idle_for > idle {
                    break;
                }
                if tokens == 0 && started.elapsed() > idle.saturating_mul(2).min(wall) {
                    break;
                }
            }
        } => {
            if run.is_cancelled() {
                log_event(data_dir, &format!("run {} cancelled by user", run.id));
                Err(cancelled_err())
            } else if started.elapsed() > wall {
                log_event(data_dir, &format!("run {} wall-clock cap {}ms", run.id, caps.wall_ms));
                Err((StatusCode::GATEWAY_TIMEOUT, capped_msg("wall-clock timeout")))
            } else {
                log_event(data_dir, &format!("run {} idle watchdog fired", run.id));
                Err((StatusCode::GATEWAY_TIMEOUT, capped_msg("idle watchdog (no tokens)")))
            }
        }
        r = fut() => {
            r.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
        }
    };
    result
}
