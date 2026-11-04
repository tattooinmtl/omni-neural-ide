#![cfg(all(windows, feature = "native-window"))]

use std::path::PathBuf;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::windows::{EventLoopBuilderExtWindows, IconExtWindows, WindowBuilderExtWindows, WindowExtWindows},
    window::{Icon, WindowBuilder},
};
use wry::{WebContext, WebViewBuilder};

pub fn run_native(url: String, title: String, user_data_dir: PathBuf) -> Result<(), String> {
    let _ = std::fs::create_dir_all(&user_data_dir);

    let event_loop = EventLoopBuilder::new()
        .with_any_thread(true)
        .build();

    let icon = load_window_icon();

    let mut wb = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(1168.0, 784.0));
    if let Some((small, big)) = icon {
        wb = wb.with_window_icon(Some(small)).with_taskbar_icon(Some(big));
    }
    let window = wb.build(&event_loop).map_err(|e| format!("create window: {e}"))?;
    // Belt and braces: WM_SETICON small + big straight from the exe's embedded resource #1.
    set_icons_from_resource(window.hwnd());

    apply_dark_caption(window.hwnd());

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

fn apply_dark_caption(hwnd: isize) {
    // DWMWA_USE_IMMERSIVE_DARK_MODE=20, BORDER=34, CAPTION=35, TEXT=36
    unsafe {
        let dark: i32 = 1;
        let _ = dwm_set(hwnd, 20, &dark as *const _ as *const u8, 4);
        let caption: u32 = 0x00150A05; // navy COLORREF
        let _ = dwm_set(hwnd, 35, &caption as *const _ as *const u8, 4);
        let text: u32 = 0x0088FF00; // #00FF88
        let _ = dwm_set(hwnd, 36, &text as *const _ as *const u8, 4);
        let _ = dwm_set(hwnd, 34, &caption as *const _ as *const u8, 4);
    }
}

unsafe fn dwm_set(hwnd: isize, attr: u32, ptr: *const u8, size: u32) -> i32 {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const u8, size: u32) -> i32;
    }
    DwmSetWindowAttribute(hwnd, attr, ptr, size)
}

/// (small caption icon, big taskbar/Alt-Tab icon). Embedded resource #1 first (always present in
/// omni-core.exe via build.rs), then the .ico next to the install. PNG via LoadImage does NOT work.
fn load_window_icon() -> Option<(Icon, Icon)> {
    use tao::dpi::PhysicalSize;
    if let (Ok(s), Ok(b)) = (
        Icon::from_resource(1, Some(PhysicalSize::new(32, 32))),
        Icon::from_resource(1, Some(PhysicalSize::new(256, 256))),
    ) {
        return Some((s, b));
    }
    let candidates = [
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("omni.ico"))),
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("..").join("assets").join("omni.ico"))),
    ];
    for c in candidates.into_iter().flatten() {
        if let (Ok(s), Ok(b)) = (
            Icon::from_path(&c, Some(PhysicalSize::new(32, 32))),
            Icon::from_path(&c, Some(PhysicalSize::new(256, 256))),
        ) {
            return Some((s, b));
        }
    }
    None
}

fn set_icons_from_resource(hwnd: isize) {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR,
        SM_CXICON, SM_CXSMICON, WM_SETICON,
    };
    unsafe {
        let hinst = GetModuleHandleW(std::ptr::null());
        let res = 1usize as *const u16; // MAKEINTRESOURCE(1)
        let cs = GetSystemMetrics(SM_CXSMICON);
        let cb = GetSystemMetrics(SM_CXICON);
        let small = LoadImageW(hinst, res, IMAGE_ICON, cs, cs, LR_DEFAULTCOLOR);
        let big = LoadImageW(hinst, res, IMAGE_ICON, cb, cb, LR_DEFAULTCOLOR);
        let h = hwnd as windows_sys::Win32::Foundation::HWND;
        if !small.is_null() { SendMessageW(h, WM_SETICON, ICON_SMALL as usize, small as isize); }
        if !big.is_null() { SendMessageW(h, WM_SETICON, ICON_BIG as usize, big as isize); }
    }
}
