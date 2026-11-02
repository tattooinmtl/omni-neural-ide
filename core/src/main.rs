//! OMNI-CODE core.
//!
//! This process is the harness and the application window. It serves the shell
//! on a fixed loopback port, then opens that address in a system webview.
//! Accepts --style ultra|plain from the launcher.

#![windows_subsystem = "windows"]

mod app;
mod assistant;
mod commands;
mod drift;
mod emotion;
mod eventbus;
mod guard;
mod harness;
mod registry;
mod server;
mod settings;
mod tts;
mod window;

use anyhow::Context;
use app::{locate_install_root, Core};
use mimalloc::MiMalloc;
use std::env;
use std::time::{Duration, Instant};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

const LISTEN_PORT: u16 = 47321;
const SERVER_READY_TIMEOUT: Duration = Duration::from_secs(20);

fn main() {
    if let Err(err) = run() {
        report_failure(&err);
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "omni_core=info".into()),
        )
        .init();

    let style = parse_style();
    let install_root = locate_install_root();
    let mut core = Core::boot(install_root);
    core.settings.version_style = style.clone();
    let _ = core.settings.save(&core.settings_path);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("tokio runtime")?;
    let mut server = Some(runtime.spawn(server::serve(core, LISTEN_PORT)));
    wait_for_server(&runtime, &mut server, LISTEN_PORT)?;
    window::open(LISTEN_PORT)?;
    Ok(())
}

fn parse_style() -> String {
    let args: Vec<String> = env::args().collect();
    for i in 0..args.len() {
        if args[i] == "--style" && i + 1 < args.len() {
            let s = args[i + 1].to_lowercase();
            if s == "plain" || s == "ultra" {
                return s;
            }
        }
    }
    if let Ok(s) = env::var("OMNI_STYLE") {
        let s = s.to_lowercase();
        if s == "plain" || s == "ultra" {
            return s;
        }
    }
    "ultra".into()
}

fn wait_for_server(
    runtime: &tokio::runtime::Runtime,
    task: &mut Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
    port: u16,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + SERVER_READY_TIMEOUT;
    while Instant::now() < deadline {
        if health_ok(port) {
            return Ok(());
        }
        if task.as_ref().is_some_and(tokio::task::JoinHandle::is_finished) {
            let Some(handle) = task.take() else {
                anyhow::bail!("loopback server task was already taken");
            };
            return match runtime.block_on(handle) {
                Ok(Ok(())) => anyhow::bail!("loopback server stopped before it answered"),
                Ok(Err(err)) => Err(err),
                Err(err) => Err(err).context("loopback server task"),
            };
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    anyhow::bail!("loopback server did not answer on 127.0.0.1:{port}")
}

fn health_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    if stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0_u8; 512];
    let Ok(count) = stream.read(&mut buf) else {
        return false;
    };
    let text = String::from_utf8_lossy(&buf[..count]);
    text.contains("200") && text.contains("\"ok\":true")
}

fn report_failure(err: &anyhow::Error) {
    let text = format!("OMNI-CODE could not start.\n\n{err:#}");
    eprintln!("{text}");
    message_box(&text);
}

#[cfg(windows)]
fn message_box(text: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    let wide = |value: &str| {
        OsStr::new(value).encode_wide().chain(Some(0)).collect::<Vec<u16>>()
    };
    let message = wide(text);
    let title = wide("OMNI-CODE");
    const MB_ICONERROR: u32 = 0x0000_0010;
    let _ = unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_ICONERROR) };
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(hwnd: *mut std::ffi::c_void, text: *const u16, caption: *const u16, flags: u32) -> i32;
}

#[cfg(not(windows))]
fn message_box(_text: &str) {}
