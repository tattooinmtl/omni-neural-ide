mod guardrails;
mod fsapi;
mod ai;
mod harness;
mod state;
mod tts;
#[cfg(all(windows, feature = "native-window"))]
mod native_win;

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
    #[arg(long, default_value = "plain")]
    mode: String,
    #[arg(long, default_value = "8741")]
    port: u16,
    #[arg(long)]
    data_dir: Option<PathBuf>,
    #[arg(long)]
    ui_dir: Option<PathBuf>,
    #[arg(long)]
    project: Option<PathBuf>,
    /// Open a native wry/tao window (Windows). Default true on Windows builds with feature.
    #[arg(long, default_value_t = cfg!(all(windows, feature = "native-window")))]
    native: bool,
    /// Also serve fixture chat JSON / fixtures root
    #[arg(long)]
    fixtures_dir: Option<PathBuf>,
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
    let fixtures = args.fixtures_dir.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
    });

    let mut app = Router::new().merge(api).layer(CorsLayer::permissive());
    if fixtures.join("chat").exists() {
        app = app.nest_service("/fixtures-chat", ServeDir::new(fixtures.join("chat")));
    }
    if ui_dir.join("index.html").exists() {
        app = app.fallback_service(ServeDir::new(&ui_dir).append_index_html_on_directories(true));
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    tracing::info!("OMNI-CODE core ({mode}) listening on http://{addr}");
    tracing::info!("data_dir={} ui_dir={}", data_dir.display(), ui_dir.display());

    let listener = tokio::net::TcpListener::bind(addr).await?;

    #[cfg(all(windows, feature = "native-window"))]
    {
        if args.native {
            // Serve in background; native window blocks main-ish via spawn_blocking
            let server = axum::serve(listener, app);
            tokio::spawn(async move {
                if let Err(e) = server.await {
                    tracing::error!("server error: {e}");
                }
            });
            // Wait until port accepts
            for _ in 0..50 {
                if tokio::net::TcpStream::connect(addr).await.is_ok() { break; }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let url = format!("http://{addr}/?mode={mode}");
            let title = if mode == "ultra" { "OMNI-CODE Ultra" } else { "OMNI-CODE" };
            tracing::info!("opening native wry window: {url}");
            // wry/tao event loop is not Send on all platforms — run in a dedicated OS thread
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let r = native_win::run_native(url, title.into());
                let _ = tx.send(r);
            });
            // Keep tokio alive while window is open
            loop {
                if rx.try_recv().is_ok() { break; }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            return Ok(());
        }
    }

    axum::serve(listener, app).await?;
    Ok(())
}
