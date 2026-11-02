//! Loopback HTTP API and the static Ultra shell.
//!
//! The native window loads this address. Nothing here listens on a public interface.

use crate::app::Core;
use crate::eventbus::EventBus;
use crate::settings::Settings;
use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde::Serialize;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct AppState {
    core: Arc<Mutex<Core>>,
    bus: EventBus,
}

#[derive(Serialize)]
struct Envelope {
    ok: bool,
    message: String,
    content: Option<String>,
    state: crate::app::StateDto,
}

#[derive(Deserialize)]
struct GoalBody {
    goal: String,
}

#[derive(Deserialize)]
struct LineBody {
    line: String,
}

#[derive(Deserialize)]
struct ReviewBody {
    decision: String,
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

#[derive(Deserialize)]
struct AssistantBody {
    action: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    on: Option<bool>,
}

pub async fn serve(core: Core, port: u16) -> anyhow::Result<()> {
    let ui = core.install_root.join("ui");
    let three = ui.join("node_modules").join("three");
    let bus = core.bus.clone();
    let state = AppState {
        core: Arc::new(Mutex::new(core)),
        bus,
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(state_of))
        .route("/api/intake", post(intake))
        .route("/api/resume", post(resume))
        .route("/api/review", post(review))
        .route("/api/command", post(command))
        .route("/api/assistant", post(assistant))
        .route("/api/open", post(open_file))
        .route("/api/file", get(read_file).post(write_file))
        .route("/api/settings", post(save_settings))
        .route("/api/events", get(events))
        .nest_service("/vendor/three", ServeDir::new(three))
        .fallback_service(ServeDir::new(ui))
        .with_state(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::event!(
        name: "core.listen.started",
        tracing::Level::INFO,
        server.address = %addr,
        "listening on {{server.address}}"
    );
    axum::serve(listener, router).await?;
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn state_of(State(app): State<AppState>) -> Json<Envelope> {
    let core = lock(&app);
    reply(&core, true, "ok", None)
}

async fn intake(State(app): State<AppState>, Json(body): Json<GoalBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.intake(&body.goal) {
        Ok(()) => {
            let message = core.harness.status_detail.clone();
            reply(&core, true, message, None)
        }
        Err(err) => reply(&core, false, err, None),
    }
}

async fn resume(State(app): State<AppState>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.resume_run() {
        Ok(()) => {
            let message = core.harness.status_detail.clone();
            reply(&core, true, message, None)
        }
        Err(err) => reply(&core, false, err, None),
    }
}

async fn review(State(app): State<AppState>, Json(body): Json<ReviewBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    let result = match body.decision.as_str() {
        "accept" => core.harness.accept().map(|()| "accepted".to_string()),
        "reject" => core.harness.reject().map(|()| "rejected".to_string()),
        _ => Err("decision must be accept or reject".into()),
    };
    match result {
        Ok(message) => reply(&core, true, message, None),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn command(State(app): State<AppState>, Json(body): Json<LineBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    let message = core.slash(&body.line);
    let ok = !message.starts_with("unknown:") && !message.starts_with("usage:");
    reply(&core, ok, message, None)
}

async fn assistant(State(app): State<AppState>, Json(body): Json<AssistantBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    let result = match body.action.as_str() {
        "note" => core.assistant_note(&body.text),
        "steer" => Ok(core.steer(&body.text)),
        "audit" => Ok(core.assistant_audit()),
        "mark" => core.assistant_mark(&body.path, &body.text),
        "edit" => core.assistant_edit(&body.path, &body.content),
        "voice" => {
            let on = body.on.unwrap_or(!core.settings.voice_mode);
            core.set_voice(on)
        }
        "mute" => {
            let muted = body.on.unwrap_or(!core.settings.muted);
            core.set_muted(muted)
        }
        "clear-drift" => Ok(core.clear_drift_flag()),
        other => Err(format!("unknown assistant action: {other}")),
    };
    match result {
        Ok(message) => reply(&core, true, message, None),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn open_file(State(app): State<AppState>, Json(body): Json<PathBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.open_project_file(&body.path) {
        Ok(content) => reply(&core, true, "opened", Some(content)),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn read_file(State(app): State<AppState>, Query(query): Query<FileQuery>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.open_project_file(&query.path) {
        Ok(content) => reply(&core, true, "opened", Some(content)),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn write_file(State(app): State<AppState>, Json(body): Json<PathBody>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.save_project_file(&body.path, &body.content) {
        Ok(()) => reply(&core, true, "saved", Some(body.content)),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn save_settings(State(app): State<AppState>, Json(settings): Json<Settings>) -> Json<Envelope> {
    let mut core = lock(&app);
    match core.apply_settings(settings) {
        Ok(()) => reply(&core, true, "settings saved", None),
        Err(err) => reply(&core, false, err, None),
    }
}

async fn events(State(app): State<AppState>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = app.bus.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|item| {
        let event = item.ok()?;
        let data = serde_json::to_string(&event).ok()?;
        Some(Ok(Event::default().data(data)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn lock(app: &AppState) -> std::sync::MutexGuard<'_, Core> {
    // A poisoned lock means another thread already panicked. Keep serving the state we still have.
    app.core.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn reply(core: &Core, ok: bool, message: impl Into<String>, content: Option<String>) -> Json<Envelope> {
    Json(Envelope {
        ok,
        message: message.into(),
        content,
        state: core.view(),
    })
}
