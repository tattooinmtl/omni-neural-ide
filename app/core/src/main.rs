mod guardrails;
mod fsapi;
mod ai;
mod harness;
mod tts;
#[cfg(all(windows, feature = "native-window"))]
mod native_win;
mod state;

use axum::{
    routing::{get, post},
    Router,
};
use clap::Parser;
use state::AppState;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "omni-core", about = "OMNI-CODE / Ultra core")]
struct Args {
    /// plain | ultra — set by Go launcher every launch
    #[arg(long, default_value = "plain")]
    mode: String,

    /// HTTP API + UI port
    #[arg(long, default_value = "8741")]
    port: u16,

    /// Install / data root
    #[arg(long)]
    data_dir: Option<PathBuf>,

    /// Directory of built UI assets (optional)
    #[arg(long)]
    ui_dir: Option<PathBuf>,

    /// Open project folder on start
    #[arg(long)]
    project: Option<PathBuf>,

    /// Open wry/tao native window (Windows; requires native-window feature)
    #[arg(long, default_value_t = true)]
    native: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("omni_core=info".parse()?))
        .init();

    let args = Args::parse();
    let mode = if args.mode.eq_ignore_ascii_case("ultra") { "ultra" } else { "plain" };

    let data_dir = args.data_dir.unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".omni-neural-ide")
    });
    std::fs::create_dir_all(data_dir.join("sandbox"))?;
    std::fs::create_dir_all(data_dir.join("keys"))?;

    let state = Arc::new(AppState::new(mode, data_dir.clone(), args.project)?);

    let api = Router::new()
        .route("/api/health", get(fsapi::health))
        .route("/api/config", get(fsapi::config))
        .route("/api/keys", post(fsapi::set_keys))
        .route("/api/fs/list", get(fsapi::list_dir))
        .route("/api/fs/read", get(fsapi::read_file))
        .route("/api/fs/write", post(fsapi::write_file))
        .route("/api/fs/open", post(fsapi::open_folder))
        .route("/api/fs/tree", get(fsapi::tree))
        .route("/api/fs/delete", post(fsapi::delete_path))
        .route("/api/chat", post(ai::chat))
        .route("/api/slash", post(harness::slash))
        .route("/api/tts", post(tts::tts))
        .route("/api/harness/run", post(harness::run_loop))
        .route("/api/harness/drift-mode", post(harness::set_drift_mode))
        .with_state(state.clone());

    let ui_dir = args.ui_dir.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ui/dist")
    });

    let app = if ui_dir.join("index.html").exists() {
        Router::new()
            .merge(api)
            .fallback_service(ServeDir::new(ui_dir))
            .layer(CorsLayer::permissive())
    } else {
        api.layer(CorsLayer::permissive())
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    tracing::info!("OMNI-CODE core ({mode}) listening on http://{addr}");
    tracing::info!("data_dir={}", data_dir.display());

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
