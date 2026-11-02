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

const WINDOW_WIDTH: f64 = 1440.0;
const WINDOW_HEIGHT: f64 = 900.0;
const MIN_WINDOW_WIDTH: f64 = 960.0;
const MIN_WINDOW_HEIGHT: f64 = 640.0;

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
    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .with_background_color((12, 14, 20, 255))
        .with_devtools(cfg!(debug_assertions))
        .build(&window)
        .context("create webview")?;

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
