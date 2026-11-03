#![cfg(all(windows, feature = "native-window"))]

use std::path::PathBuf;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::windows::EventLoopBuilderExtWindows,
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder};

/// Block on the native window event loop. Call after the HTTP server is listening.
/// `user_data_dir` must be a writable folder (e.g. <install>/webview2).
pub fn run_native(url: String, title: String, user_data_dir: PathBuf) -> Result<(), String> {
    let _ = std::fs::create_dir_all(&user_data_dir);

    // Launcher/core start the UI from a worker thread while tokio owns main.
    // tao requires with_any_thread(true) on Windows in that case.
    let event_loop = EventLoopBuilder::new()
        .with_any_thread(true)
        .build();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1168.0, 784.0))
        .build(&event_loop)
        .map_err(|e| format!("create window: {e}"))?;

    let mut context = WebContext::new(Some(user_data_dir));
    let _webview = WebViewBuilder::with_web_context(&mut context)
        .with_url(&url)
        .build(&window)
        .map_err(|e| format!("create webview: {e}"))?;

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
