//! Native OMNI-CODE window.
//!
//! The window is the system webview. It loads the loopback shell after the
//! harness is already listening. Closing the window ends this process.

use anyhow::Context;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

/// First window size. Wide enough for the explorer, the editor, and the floating assistant.
const WINDOW_WIDTH: f64 = 1440.0;
/// Matches [`WINDOW_WIDTH`] so the bottom problems row and the assistant both fit.
const WINDOW_HEIGHT: f64 = 900.0;
const MIN_WINDOW_WIDTH: f64 = 960.0;
const MIN_WINDOW_HEIGHT: f64 = 640.0;

/// Open the OMNI-CODE window on `http://127.0.0.1:{port}/`.
///
/// The event loop stays on the calling thread. This returns when the user closes the window.
pub fn open(port: u16) -> anyhow::Result<()> {
    quiet_webview_chrome();
    let url = format!("http://127.0.0.1:{port}/");
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("OMNI-CODE")
        .with_inner_size(LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT))
        .with_min_inner_size(LogicalSize::new(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT))
        .build(&event_loop)
        .context("create window")?;
    // Shell background, so the webview does not flash white before the page paints.
    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .with_background_color((12, 14, 20, 255))
        .with_devtools(cfg!(debug_assertions))
        .build(&window)
        .context("create webview")?;
    tracing::event!(
        name: "core.window.opened",
        tracing::Level::INFO,
        url = %url,
        "opened window at {{url}}"
    );

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}

/// Hide the Windows WebView2 selection mini-menu so the page context menu is the only one.
///
/// The runtime reads `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` while the webview is created.
#[cfg(windows)]
fn quiet_webview_chrome() {
    const FLAG: &str = "--disable-features=msWebOOUI,msPdfOOUI";
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    match std::env::var(KEY) {
        Ok(existing) if existing.contains("msWebOOUI") => {}
        Ok(existing) if existing.is_empty() => std::env::set_var(KEY, FLAG),
        Ok(existing) => std::env::set_var(KEY, format!("{existing} {FLAG}")),
        Err(_) => std::env::set_var(KEY, FLAG),
    }
}

#[cfg(not(windows))]
fn quiet_webview_chrome() {}
