#![cfg(all(windows, feature = "native-window"))]

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

/// Block on the native window event loop. Call after the HTTP server is listening.
pub fn run_native(url: String, title: String) -> Result<(), String> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1168.0, 784.0))
        .build(&event_loop)
        .map_err(|e| e.to_string())?;

    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .build(&window)
        .map_err(|e| e.to_string())?;

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
