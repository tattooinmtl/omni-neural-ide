#![cfg(all(windows, feature = "native-window"))]
use std::path::PathBuf;
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

pub fn run_native(url: String, title: String) -> wry::Result<()> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(tao::dpi::LogicalSize::new(1168.0, 784.0))
        .build(&event_loop)
        .unwrap();
    let _webview = WebViewBuilder::new(&window)
        .with_url(&url)
        .build()?;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent { event: WindowEvent::CloseRequested, .. } = event {
            *control_flow = ControlFlow::Exit;
        }
    });
}
