#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod guardrails;
mod fsapi;
mod ai;
mod pool;
mod activity;
mod update;
mod mcp;
mod agent_run;
mod secrets;
mod python;
mod delegate;
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

fn default_data_dir() -> PathBuf {
    if let Ok(v) = std::env::var("OMNI_HOME") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".omni-neural-ide")
}

fn init_logging(data_dir: &std::path::Path) {
    let log_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("omni-core.log");
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("omni_core=info"));

    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(file) => {
            // Mutex<File> implements MakeWriter
            let _ = tracing_subscriber::fmt()
                .with_env_filter(env_filter)
                .with_ansi(false)
                .with_writer(std::sync::Mutex::new(file))
                .try_init();
            // also tee a startup line via reopen is fine; fmt already writes
            let _ = log_path;
        }
        Err(_) => {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(env_filter)
                .try_init();
        }
    }
}

#[cfg(windows)]
mod winmsg {
    #[link(name = "user32")]
    unsafe extern "system" {
        pub fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            flags: u32,
        ) -> i32;
    }
}

#[cfg(windows)]
fn message_box(text: &str, caption: &str) {
    use std::os::windows::ffi::OsStrExt;
    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    let text_w = wide(text);
    let cap_w = wide(caption);
    unsafe {
        winmsg::MessageBoxW(
            std::ptr::null_mut(),
            text_w.as_ptr(),
            cap_w.as_ptr(),
            0x10, // MB_ICONERROR
        );
    }
}

#[cfg(not(windows))]
fn message_box(text: &str, _caption: &str) {
    eprintln!("{text}");
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        let msg = format!("{e:#}");
        tracing::error!("fatal: {msg}");
        message_box(
            &format!("OMNI-CODE failed to start:\n\n{msg}\n\nSee logs under %USERPROFILE%\\.omni-neural-ide\\logs\\"),
            "OMNI-CODE",
        );
        std::process::exit(1);
    }
}


fn clear_webview_cache_on_version_change(data_dir: &std::path::Path) {
    let stamp = data_dir.join("webview2").join(".omni-asset-ver");
    let current = env!("CARGO_PKG_VERSION");
    let prev = std::fs::read_to_string(&stamp).unwrap_or_default();
    if prev.trim() == current {
        return;
    }
    // Drop WebView2 HTTP/image caches so digital face assets cannot stick after updates.
    for name in [
        "Cache",
        "Code Cache",
        "GPUCache",
        "GrShaderCache",
        "ShaderCache",
        "Service Worker",
        "blob_storage",
        "DawnWebGPUCache",
        "DawnGraphiteCache",
    ] {
        let p = data_dir.join("webview2").join(name);
        let _ = std::fs::remove_dir_all(&p);
    }
    let _ = std::fs::write(&stamp, current);
}

async fn run() -> anyhow::Result<()> {
    let args = Args::parse();
    let mode = if args.mode.eq_ignore_ascii_case("ultra") {
        "ultra"
    } else {
        "plain"
    };

    let data_dir = args.data_dir.unwrap_or_else(default_data_dir);
    std::fs::create_dir_all(data_dir.join("sandbox"))?;
    std::fs::create_dir_all(data_dir.join("keys"))?;
    std::fs::create_dir_all(data_dir.join("logs"))?;
    std::fs::create_dir_all(data_dir.join("webview2"))?;
    clear_webview_cache_on_version_change(&data_dir);

    init_logging(&data_dir);

    let state = Arc::new(AppState::new(mode, data_dir.clone(), args.project)?);

    let api = Router::new()
        .route("/api/health", get(fsapi::health))
        .route("/api/config", get(fsapi::config))
        .route("/api/keys", get(fsapi::get_keys).post(fsapi::set_keys))
        .route("/api/store/info", get(fsapi::store_info))
        .route("/api/store/setting", get(fsapi::get_setting).post(fsapi::set_setting))
        .route("/api/keys/export", post(fsapi::export_keys))
        .route("/api/keys/import", post(fsapi::import_keys))
        .route("/api/keys/wipe-migrated", post(fsapi::wipe_migrated))
        .route("/api/python/status", get(python::status))
        .route("/api/python/setup", post(python::setup))
        .route("/api/python/run", post(python::run))
        .route("/api/python/pip", post(python::pip_install))
        .route("/api/python/test", post(python::test))
        .route("/api/fs/list", get(fsapi::list_dir))
        .route("/api/fs/read", get(fsapi::read_file))
        .route("/api/fs/write", post(fsapi::write_file))
        .route("/api/fs/open", post(fsapi::open_folder))
        .route("/api/fs/tree", get(fsapi::tree))
        .route("/api/fs/delete", post(fsapi::delete_path))
        .route("/api/fs/mkdir", post(fsapi::mkdir))
        .route("/api/fs/rename", post(fsapi::rename_path))
        .route("/api/fs/copy", post(fsapi::copy_path))
        .route("/api/term/exec", post(fsapi::term_exec))
        .route("/api/chat", post(ai::chat))
        .route("/api/agent/stop", post(agent_run::stop_run))
        .route("/api/agent/status", get(agent_run::run_status))
        .route("/api/omni/chat", post(ai::omni_chat))
        .route("/api/omni/volunteer", post(ai::omni_volunteer))
        .route("/api/embed", post(ai::embed))
        .route("/api/side", post(ai::side_task))
        .route("/api/slash", post(harness::slash))
        .route("/api/tts", post(tts::tts))
        .route("/api/activity", get(activity::activity))
        .route("/api/client-log", post(fsapi::client_log))
        .route("/api/update/check", get(update::check))
        .route("/api/update/apply", post(update::apply))
        .route("/api/mcp/status", get(mcp::status))
        .route("/api/mcp/test", post(mcp::test_connector))
        .route("/api/mcp/tools", get(mcp::list_tools))
        .route("/api/mcp/call", post(mcp::call_tool))
        .route("/api/omni/delegate", post(delegate::delegate_to_coding_agent))
        .route("/api/omni/delegates", get(delegate::list_delegates))
        .route("/api/harness/run", post(harness::run_loop))
        .route("/api/harness/drift-mode", post(harness::set_drift_mode))
        .with_state(state.clone());

    let ui_dir = args.ui_dir.unwrap_or_else(|| {
        // Prefer install layout relative to the running exe: ../ui/dist
        if let Ok(exe) = std::env::current_exe() {
            if let Some(bin) = exe.parent() {
                let cand = bin.join("..").join("ui").join("dist");
                if cand.join("index.html").exists() {
                    return cand;
                }
            }
        }
        data_dir.join("ui").join("dist")
    });
    let fixtures = args.fixtures_dir.unwrap_or_else(|| {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(bin) = exe.parent() {
                let cand = bin.join("..").join("fixtures");
                if cand.exists() {
                    return cand;
                }
            }
        }
        data_dir.join("fixtures")
    });

    if !ui_dir.join("index.html").exists() {
        anyhow::bail!(
            "UI not found at {}\\index.html. Reinstall OMNI-CODE or pass --ui-dir.",
            ui_dir.display()
        );
    }

    let mut app = Router::new().merge(api).layer(CorsLayer::permissive());
    if fixtures.join("chat").exists() {
        app = app.nest_service("/fixtures-chat", ServeDir::new(fixtures.join("chat")));
    }
    app = app.fallback_service(ServeDir::new(&ui_dir).append_index_html_on_directories(true));

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    tracing::info!("OMNI-CODE core ({mode}) listening on http://{addr}");
    tracing::info!("data_dir={} ui_dir={}", data_dir.display(), ui_dir.display());

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => anyhow::bail!("could not bind {addr}: {e}. Is another OMNI-CODE already running?"),
    };

    #[cfg(all(windows, feature = "native-window"))]
    {
        if args.native {
            let server = axum::serve(listener, app);
            tokio::spawn(async move {
                if let Err(e) = server.await {
                    tracing::error!("server error: {e}");
                }
            });
            for _ in 0..50 {
                if tokio::net::TcpStream::connect(addr).await.is_ok() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let url = format!("http://{addr}/?mode={mode}");
            let title = if mode == "ultra" {
                "OMNI-CODE Ultra"
            } else {
                "OMNI-CODE"
            };
            let user_data = data_dir.join("webview2");
            tracing::info!("opening native wry window: {url} data={}", user_data.display());
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let r = native_win::run_native(url, title.into(), user_data);
                let _ = tx.send(r);
            });
            loop {
                match rx.try_recv() {
                    Ok(Ok(())) => break,
                    Ok(Err(e)) => anyhow::bail!("native window error: {e}"),
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        anyhow::bail!("native window thread ended unexpectedly");
                    }
                }
            }
            return Ok(());
        }
    }

    axum::serve(listener, app).await?;
    Ok(())
}
